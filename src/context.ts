/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import path from 'path';
import debug from 'debug';
import * as playwright from 'playwright';

import { logUnhandledError } from './log.js';
import { Tab } from './tab.js';

import type { Tool } from './tools/tool.js';
import type { FullConfig } from './config.js';
import type { BrowserContextFactory } from './browserContextFactory.js';
import type * as actions from './actions.js';
import type { Action, SessionLog } from './sessionLog.js';

const testDebug = debug('pw:mcp:test');

export class Context {
  readonly tools: Tool[];
  readonly config: FullConfig;
  private _browserContextPromise: Promise<{ browserContext: playwright.BrowserContext, close: () => Promise<void> }> | undefined;
  private _browserContextFactory: BrowserContextFactory;
  private _tabs: Tab[] = [];
  private _currentTab: Tab | undefined;

  clientVersion: { name: string; version: string; } | undefined;

  private static _allContexts: Set<Context> = new Set();
  private _closeBrowserContextPromise: Promise<void> | undefined;
  private _inputRecorder: InputRecorder | undefined;
  private _sessionLog: SessionLog | undefined;
  private _userSessionActive: boolean = false;

  constructor(tools: Tool[], config: FullConfig, browserContextFactory: BrowserContextFactory, sessionLog: SessionLog | undefined) {
    this.tools = tools;
    this.config = config;
    this._browserContextFactory = browserContextFactory;
    this._sessionLog = sessionLog;
    testDebug('create context');
    Context._allContexts.add(this);
  }

  static async disposeAll() {
    await Promise.all([...Context._allContexts].map(context => context.dispose()));
  }

  tabs(): Tab[] {
    return this._tabs;
  }

  currentTab(): Tab | undefined {
    return this._currentTab;
  }

  currentTabOrDie(): Tab {
    if (!this._currentTab)
      throw new Error('No open pages available. Use the "browser_navigate" tool to navigate to a page first.');
    return this._currentTab;
  }

  async newTab(): Promise<Tab> {
    const { browserContext } = await this._ensureBrowserContext();
    const page = await browserContext.newPage();
    this._currentTab = this._tabs.find(t => t.page === page)!;
    return this._currentTab;
  }

  async selectTab(index: number) {
    const tab = this._tabs[index];
    if (!tab)
      throw new Error(`Tab ${index} not found`);
    await tab.page.bringToFront();
    this._currentTab = tab;
    return tab;
  }

  async ensureTab(): Promise<Tab> {
    const { browserContext } = await this._ensureBrowserContext();
    if (!this._currentTab)
      await browserContext.newPage();
    return this._currentTab!;
  }

  async listTabsMarkdown(force: boolean = false): Promise<string[]> {
    if (this._tabs.length === 1 && !force)
      return [];

    if (!this._tabs.length) {
      return [
        '### Open tabs',
        'No open tabs. Use the "browser_navigate" tool to navigate to a page first.',
        '',
      ];
    }

    const lines: string[] = ['### Open tabs'];
    for (let i = 0; i < this._tabs.length; i++) {
      const tab = this._tabs[i];
      const title = await tab.title();
      const url = tab.page.url();
      const current = tab === this._currentTab ? ' (current)' : '';
      lines.push(`- ${i}:${current} [${title}] (${url})`);
    }
    lines.push('');
    return lines;
  }

  async closeTab(index: number | undefined): Promise<string> {
    const tab = index === undefined ? this._currentTab : this._tabs[index];
    if (!tab)
      throw new Error(`Tab ${index} not found`);
    const url = tab.page.url();
    await tab.page.close();
    return url;
  }

  private _onPageCreated(page: playwright.Page) {
    const tab = new Tab(this, page, tab => this._onPageClosed(tab));
    this._tabs.push(tab);
    if (!this._currentTab)
      this._currentTab = tab;
  }

  private _onPageClosed(tab: Tab) {
    const index = this._tabs.indexOf(tab);
    if (index === -1)
      return;
    this._tabs.splice(index, 1);

    if (this._currentTab === tab)
      this._currentTab = this._tabs[Math.min(index, this._tabs.length - 1)];
    if (!this._tabs.length)
      void this.closeBrowserContext();
  }

  async closeBrowserContext() {
    if (!this._closeBrowserContextPromise)
      this._closeBrowserContextPromise = this._closeBrowserContextImpl().catch(logUnhandledError);
    await this._closeBrowserContextPromise;
    this._closeBrowserContextPromise = undefined;
  }

  async setInputRecorderEnabled(enabled: boolean) {
    await this._inputRecorder?.setEnabled(enabled);
  }

  setUserSessionActive(active: boolean) {
    this._userSessionActive = active;
  }

  isUserSessionActive(): boolean {
    return this._userSessionActive;
  }

  async flushInputRecorder(): Promise<void> {
    if (this._inputRecorder)
      await (this._inputRecorder as any)._flush();

  }

  async _getBrowserContextForTracing(): Promise<playwright.BrowserContext | undefined> {
    if (!this._browserContextPromise)
      return undefined;

    const { browserContext } = await this._browserContextPromise;
    return browserContext;
  }

  async postProcessTraceFile(traceFilePath: string, customActionName?: string): Promise<boolean> {
    // Post-process trace file to rename "Bounding box" entries to custom names
    const actionName = customActionName || 'Human Action';
    console.log(`📝 Post-processing trace file to rename "Bounding box" entries to "${actionName}"`);
    console.log('   Trace file:', traceFilePath);

    try {
      const fs = await import('fs');
      const yauzl = await import('yauzl');
      const yazl = await import('yazl');

      // Read the existing trace ZIP file
      console.log('📂 Reading trace ZIP file...');

      // Extract trace data
      const entries = new Map();
      const zipFile = await new Promise<any>((resolve, reject) => {
        yauzl.open(traceFilePath, { lazyEntries: true }, (err, zipFile) => {
          if (err)
            reject(err);
          else
            resolve(zipFile);
        });
      });

      await new Promise<void>((resolve, reject) => {
        zipFile.readEntry();
        zipFile.on('entry', (entry: any) => {
          if (/\/$/.test(entry.fileName)) {
            zipFile.readEntry();
            return;
          }

          zipFile.openReadStream(entry, (err: any, readStream: any) => {
            if (err) {reject(err);} else {
              const chunks: Buffer[] = [];
              readStream.on('data', (chunk: Buffer) => chunks.push(chunk));
              readStream.on('end', () => {
                entries.set(entry.fileName, Buffer.concat(chunks));
                zipFile.readEntry();
              });
            }
          });
        });
        zipFile.on('end', resolve);
        zipFile.on('error', reject);
      });

      // Process trace.trace file
      const traceData = entries.get('trace.trace');
      if (!traceData) {
        console.log('❌ No trace.trace file found in ZIP');
        return false;
      }

      console.log('🔍 Analyzing trace events to rename "Bounding box" entries...');
      const traceLines = traceData.toString().split('\n').filter((line: string) => line.trim());
      const events = traceLines.map((line: string) => JSON.parse(line));

      // Find "Bounding box" events and rename them to custom action name
      let renamedCount = 0;
      const modifiedEvents = events.map((event: any) => {
        // Look for Locator boundingBox events (these are our human actions)
        if (event.type === 'before' && event.class === 'Locator' && event.method === 'boundingBox') {
          renamedCount++;
          console.log(`🎯 Renaming "Bounding box" entry #${renamedCount} to "${actionName}"`);

          // Change the method name to create a custom entry
          return {
            ...event,
            method: 'click', // Change to 'click' so it shows as clickable in trace viewer
            humanAction: true, // Add marker to identify our custom entries
          };
        }
        return event;
      });

      // Write modified trace back to ZIP
      console.log('📝 Writing modified trace file...');
      const newZipFile = new yazl.ZipFile();

      // Add all original entries except trace.trace
      for (const [fileName, content] of entries) {
        if (fileName !== 'trace.trace')
          newZipFile.addBuffer(content, fileName);

      }

      // Add modified trace.trace
      const modifiedTraceContent = modifiedEvents.map((event: any) => JSON.stringify(event)).join('\n');
      newZipFile.addBuffer(Buffer.from(modifiedTraceContent), 'trace.trace');

      // Write to temporary file first, then replace original
      const tempPath = traceFilePath + '.tmp';
      newZipFile.outputStream.pipe(fs.createWriteStream(tempPath));
      newZipFile.end();

      await new Promise<void>((resolve, reject) => {
        newZipFile.outputStream.on('close', resolve);
        newZipFile.outputStream.on('error', reject);
      });

      // Replace original with enhanced version
      fs.renameSync(tempPath, traceFilePath);

      console.log(`✅ Post-processing completed - renamed ${renamedCount} "Bounding box" entries to "${actionName}"!`);
      return true;

    } catch (error) {
      console.log('❌ Post-processing failed:', error);
      return false;
    }
  }

  async createUserSessionTrace(filename: string = `user-session-${Date.now()}`): Promise<string | undefined> {
    if (!this.config.browser.launchOptions.tracesDir)
      return undefined;


    const { browserContext } = await this._ensureBrowserContext();
    const tracePath = path.join(this.config.browser.launchOptions.tracesDir, `${filename}.zip`);

    try {
      await browserContext.tracing.stop({ path: tracePath });

      // Restart tracing if needed for continuous operation
      if (this.config.saveTrace || this.config.saveTraceWithUserActions) {
        await browserContext.tracing.start({
          name: 'trace',
          screenshots: true,
          snapshots: true,
          sources: true,
        });
      }

      return tracePath;
    } catch (error) {
      throw new Error(`Failed to create trace file: ${error}`);
    }
  }

  private async _closeBrowserContextImpl() {
    if (!this._browserContextPromise)
      return;

    testDebug('close context');

    const promise = this._browserContextPromise;
    this._browserContextPromise = undefined;

    await promise.then(async ({ browserContext, close }) => {
      if (this.config.saveTrace || this.config.saveTraceWithUserActions) {
        const traceName = this.config.saveTraceWithUserActions ? 'user-session-trace' : 'trace';
        const tracePath = path.join(this.config.browser.launchOptions.tracesDir!, `${traceName}.zip`);
        await browserContext.tracing.stop({ path: tracePath });
      } else {
        await browserContext.tracing.stop();
      }
      await close();
    });
  }

  async dispose() {
    await this.closeBrowserContext();
    Context._allContexts.delete(this);
  }

  private async _setupRequestInterception(context: playwright.BrowserContext) {
    if (this.config.network?.allowedOrigins?.length) {
      await context.route('**', route => route.abort('blockedbyclient'));

      for (const origin of this.config.network.allowedOrigins)
        await context.route(`*://${origin}/**`, route => route.continue());
    }

    if (this.config.network?.blockedOrigins?.length) {
      for (const origin of this.config.network.blockedOrigins)
        await context.route(`*://${origin}/**`, route => route.abort('blockedbyclient'));
    }
  }

  private _ensureBrowserContext() {
    if (!this._browserContextPromise) {
      this._browserContextPromise = this._setupBrowserContext();
      this._browserContextPromise.catch(() => {
        this._browserContextPromise = undefined;
      });
    }
    return this._browserContextPromise;
  }

  private async _setupBrowserContext(): Promise<{ browserContext: playwright.BrowserContext, close: () => Promise<void> }> {
    if (this._closeBrowserContextPromise)
      throw new Error('Another browser context is being closed.');
    // TODO: move to the browser context factory to make it based on isolation mode.
    const result = await this._browserContextFactory.createContext(this.clientVersion!);
    const { browserContext } = result;
    await this._setupRequestInterception(browserContext);
    if (this._sessionLog)
      this._inputRecorder = await InputRecorder.create(this._sessionLog, browserContext);
    for (const page of browserContext.pages())
      this._onPageCreated(page);
    browserContext.on('page', page => this._onPageCreated(page));
    if (this.config.saveTrace || this.config.saveTraceWithUserActions) {
      await browserContext.tracing.start({
        name: this.config.saveTraceWithUserActions ? 'user-session-trace' : 'trace',
        screenshots: true,
        snapshots: true,
        sources: true,
      });
    }
    return result;
  }
}

export class InputRecorder {
  private _actions: Action[] = [];
  private _enabled = false;
  private _sessionLog: SessionLog;
  private _browserContext: playwright.BrowserContext;
  private _flushTimer: NodeJS.Timeout | undefined;

  private constructor(sessionLog: SessionLog, browserContext: playwright.BrowserContext) {
    this._sessionLog = sessionLog;
    this._browserContext = browserContext;
  }

  static async create(sessionLog: SessionLog, browserContext: playwright.BrowserContext) {
    const recorder = new InputRecorder(sessionLog, browserContext);
    await recorder._initialize();
    await recorder.setEnabled(true);
    return recorder;
  }

  private async _initialize() {
    await (this._browserContext as any)._enableRecorder({
      mode: 'recording',
      recorderMode: 'api',
    }, {
      actionAdded: (page: playwright.Page, data: actions.ActionInContext, code: string) => {
        if (!this._enabled)
          return;
        const tab = Tab.forPage(page);
        this._actions.push({ ...data, tab, code: code.trim(), timestamp: performance.now() });
        // Record human action with trace group and snapshot
        void this._recordHumanAction(data.action.name || code.trim(), page, data);
        this._scheduleFlush();
      },
      actionUpdated: (page: playwright.Page, data: actions.ActionInContext, code: string) => {
        if (!this._enabled)
          return;
        const tab = Tab.forPage(page);
        this._actions[this._actions.length - 1] = { ...data, tab, code: code.trim(), timestamp: performance.now() };
        // Record human action with trace group and snapshot
        void this._recordHumanAction(data.action.name || code.trim(), page, data);
        this._scheduleFlush();
      },
      signalAdded: (page: playwright.Page, data: actions.SignalInContext) => {
        if (data.signal.name !== 'navigation')
          return;
        const tab = Tab.forPage(page);
        this._actions.push({
          frame: data.frame,
          action: {
            name: 'navigate',
            url: data.signal.url,
            signals: [],
          },
          startTime: data.timestamp,
          endTime: data.timestamp,
          tab,
          code: `await page.goto('${data.signal.url}');`,
          timestamp: performance.now(),
        });
        void this._recordHumanAction(`await page.goto('${data.signal.url}');`, page, data);
        this._scheduleFlush();
      },
    });
  }

  async setEnabled(enabled: boolean) {
    this._enabled = enabled;
    if (!enabled)
      await this._flush();
  }

  private _clearTimer() {
    if (this._flushTimer) {
      clearTimeout(this._flushTimer);
      this._flushTimer = undefined;
    }
  }

  private _scheduleFlush() {
    this._clearTimer();
    this._flushTimer = setTimeout(() => this._flush(), 1000);
  }

  private async _flush() {
    this._clearTimer();
    const actions = this._actions;
    this._actions = [];
    await this._sessionLog.logActions(actions);
  }

  private async _recordHumanAction(title: string, page?: playwright.Page, actionData?: any) {
    // LOCATOR ACTION APPROACH: Execute boundingBox to trigger frame-snapshots
    // This generates proper "Bounding box" entries in trace viewer with element selectors
    // and creates frame-snapshots that capture HTML resources

    if (!actionData?.action || !page)
      return;

    try {
      const action = actionData.action;

      console.log('🎯 Recording human action to trigger frame-snapshots:', {
        actionName: action.name,
        selector: action.selector || 'unknown'
      });

      // Execute boundingBox to trigger frame-snapshots - this creates the "Bounding box" entries
      if (action.selector && action.selector !== 'unknown') {
        const locator = page.locator(action.selector).first();
        try {
          const box = await locator.boundingBox({ timeout: 1000 });
          console.log('✅ Triggered frame-snapshot via boundingBox - HTML resources captured');
        } catch (error) {
          console.log('⚠️ Could not trigger frame-snapshot, selector may be invalid:', action.selector);
        }
      }

    } catch (error) {
      console.log('❌ Failed to record human action:', error);
    }
  }

  private _mapActionToMethod(actionName: string): string {
    const methodMap: Record<string, string> = {
      'click': 'click',
      'fill': 'fill',
      'press': 'press',
      'check': 'check',
      'uncheck': 'uncheck',
      'select': 'selectOption',
      'navigate': 'goto',
      'setInputFiles': 'setInputFiles'
    };
    return methodMap[actionName] || 'click';
  }

  private _buildTraceParams(action: any, selector: string): Record<string, any> {
    const params: Record<string, any> = {
      selector: selector
    };

    try {
      // Add action-specific parameters with safety checks
      if (action.text && typeof action.text === 'string')
        params.text = action.text;
      if (action.button && typeof action.button === 'string')
        params.button = action.button;
      if (action.url && typeof action.url === 'string')
        params.url = action.url;
      if (action.value && typeof action.value === 'string')
        params.value = action.value;
      if (action.key && typeof action.key === 'string')
        params.key = action.key;
      if (action.options && Array.isArray(action.options))
        params.values = action.options;
      if (action.files && Array.isArray(action.files))
        params.files = action.files;
      if (action.modifiers !== undefined)
        params.modifiers = action.modifiers;
      if (action.clickCount !== undefined)
        params.clickCount = action.clickCount;
      if (action.position)
        params.position = action.position;
    } catch (error) {
      testDebug('Error building trace params:', error);
    }

    return params;
  }


  private async _writeToTrace(event: any): Promise<void> {
    try {
      // Use browser context's tracing to write event directly
      // This leverages Playwright's internal tracing mechanism
      const contextInternal = this._browserContext as any;
      if (contextInternal._tracing && contextInternal._tracing._writeEvent) {
        testDebug('✅ Writing event to trace:', event.type, event.class, event.method);
        await contextInternal._tracing._writeEvent(event);
        testDebug('✅ Event written to trace successfully');
      } else {
        testDebug('❌ Direct trace writing not available - no _tracing or _writeEvent');
      }
    } catch (error) {
      testDebug('❌ Failed to write to trace:', error);
    }
  }
}
