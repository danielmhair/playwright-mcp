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

  async postProcessTraceFile(traceFilePath: string): Promise<boolean> {
    // STEP 3: Post-process trace groups to connect them with snapshots for element highlighting
    console.log('📝 Post-processing trace file to enable element highlighting for human actions');
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
          if (err) reject(err);
          else resolve(zipFile);
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
            if (err) reject(err);
            else {
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
      
      console.log('🔍 Analyzing trace events...');
      const traceLines = traceData.toString().split('\n').filter((line: string) => line.trim());
      const events = traceLines.map((line: string) => JSON.parse(line));
      
      // Find human action trace groups and convert them to Locator events
      const enhancedEvents = [];
      let callIdCounter = 1;
      
      for (const event of events) {
        enhancedEvents.push(event);
        
        // Look for trace group events that are human actions
        if (event.type === 'before' && event.class === 'Tracing' && event.method === 'tracingGroup' && 
            event.params && event.params.title && event.params.title.startsWith('Human ')) {
          
          console.log('🎯 Found human action trace group:', event.params.title);
          
          // Extract action details from title
          const title = event.params.title;
          const actionMatch = title.match(/Human (\w+)(?:\s+on\s+(.+))?/);
          if (actionMatch) {
            const [, actionName, selector] = actionMatch;
            
            // Create a corresponding Locator event right after the trace group
            const callId = `human_${actionName}_${Date.now()}_${callIdCounter++}`;
            const locatorEvent = {
              type: 'before',
              callId: callId,
              startTime: event.startTime || performance.now(),
              class: 'Locator',  // This is what enables element highlighting!
              method: actionName.toLowerCase(),
              params: {
                selector: selector || `internal:text="${actionName}"i`,
                ...(selector && { selector }),
              },
              pageId: event.pageId || 'unknown',
              beforeSnapshot: event.beforeSnapshot || `before@${callId}`
            };
            
            enhancedEvents.push(locatorEvent);
            
            // Add corresponding 'after' event
            const afterEvent = {
              type: 'after',
              callId: callId,
              endTime: (event.startTime || performance.now()) + 1,
              result: null
            };
            
            enhancedEvents.push(afterEvent);
            
            console.log('✅ Created Locator event for:', actionName, selector);
          }
        }
      }
      
      // Write enhanced trace back to ZIP
      console.log('📝 Writing enhanced trace file...');
      const newZipFile = new yazl.ZipFile();
      
      // Add all original entries except trace.trace
      for (const [fileName, content] of entries) {
        if (fileName !== 'trace.trace') {
          newZipFile.addBuffer(content, fileName);
        }
      }
      
      // Add enhanced trace.trace
      const enhancedTraceContent = enhancedEvents.map(event => JSON.stringify(event)).join('\n');
      newZipFile.addBuffer(Buffer.from(enhancedTraceContent), 'trace.trace');
      
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
      
      console.log('✅ Post-processing completed - human actions should now support element highlighting!');
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
  private _recordingSnapshot = false; // Recursion guard

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
    // FRAME-SNAPSHOT APPROACH: Execute non-intrusive locator actions to trigger HTML capture
    //
    // Since trace groups don't create frame-snapshots (HTML resources), we execute actual
    // locator actions that DO trigger Playwright's automatic HTML capture system.

    if (!actionData?.action || !page)
      return;

    // Prevent infinite recursion
    if (this._recordingSnapshot) {
      console.log('⚠️ Skipping recursive human action recording during snapshot');
      return;
    }

    try {
      const browserContext = this._browserContext;
      const action = actionData.action;
      
      console.log('🎯 Recording human action to trigger frame-snapshots:', {
        actionName: action.name,
        selector: action.selector || 'unknown',
        approach: 'non-intrusive-locator-action'
      });

      this._recordingSnapshot = true;

      // Temporarily disable InputRecorder to prevent infinite recursion
      const wasEnabled = this._enabled;
      this._enabled = false;

      try {
        // Execute a non-intrusive locator action that will trigger frame-snapshots
        // This approach leverages Playwright's built-in tracing for automatic HTML capture
        if (action.selector && action.selector !== 'unknown') {
          const locator = page.locator(action.selector).first();
          
          try {
            // Use boundingBox() as it's completely non-intrusive but generates frame-snapshots
            const box = await locator.boundingBox({ timeout: 500 });
            console.log('✅ Triggered frame-snapshot via boundingBox - HTML resources should be captured');
          } catch (error) {
            // If boundingBox fails, try isVisible() which is even more non-intrusive
            try {
              await locator.isVisible({ timeout: 100 });
              console.log('✅ Triggered frame-snapshot via isVisible - HTML resources should be captured');
            } catch (error2) {
              console.log('⚠️ Could not trigger frame-snapshot, selector may be invalid:', action.selector);
            }
          }
        } else {
          // For actions without valid selectors, try page-level operations
          try {
            await page.title(); // Non-intrusive page operation
            console.log('✅ Triggered frame-snapshot via page.title() for action without selector');
          } catch (error) {
            console.log('⚠️ Could not trigger frame-snapshot for action without selector');
          }
        }
      } finally {
        // Re-enable InputRecorder
        this._enabled = wasEnabled;
      }

      console.log('✅ Human action recorded - frame-snapshots should contain HTML resources');

    } catch (error) {
      console.log('❌ Failed to record human action:', error);
    } finally {
      this._recordingSnapshot = false;
    }
  }

  async postProcessTraceFile(traceFilePath: string): Promise<boolean> {
    // STEP 3: Post-process trace groups to connect them with snapshots for element highlighting
    console.log('📝 Post-processing trace file to enable element highlighting for human actions');
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
          if (err) reject(err);
          else resolve(zipFile);
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
            if (err) reject(err);
            else {
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
      
      console.log('🔍 Analyzing trace events...');
      const traceLines = traceData.toString().split('\n').filter((line: string) => line.trim());
      const events = traceLines.map((line: string) => JSON.parse(line));
      
      // Find human action trace groups and convert them to Locator events
      const enhancedEvents = [];
      let callIdCounter = 1;
      
      for (const event of events) {
        enhancedEvents.push(event);
        
        // Look for trace group events that are human actions
        if (event.type === 'before' && event.class === 'Tracing' && event.method === 'tracingGroup' && 
            event.params && event.params.title && event.params.title.startsWith('Human ')) {
          
          console.log('🎯 Found human action trace group:', event.params.title);
          
          // Extract action details from title
          const title = event.params.title;
          const actionMatch = title.match(/Human (\w+)(?:\s+on\s+(.+))?/);
          if (actionMatch) {
            const [, actionName, selector] = actionMatch;
            
            // Create a corresponding Locator event right after the trace group
            const callId = `human_${actionName}_${Date.now()}_${callIdCounter++}`;
            const locatorEvent = {
              type: 'before',
              callId: callId,
              startTime: event.startTime || performance.now(),
              class: 'Locator',  // This is what enables element highlighting!
              method: actionName.toLowerCase(),
              params: {
                selector: selector || `internal:text="${actionName}"i`,
                ...(selector && { selector }),
              },
              pageId: event.pageId || 'unknown',
              beforeSnapshot: event.beforeSnapshot || `before@${callId}`
            };
            
            enhancedEvents.push(locatorEvent);
            
            // Add corresponding 'after' event
            const afterEvent = {
              type: 'after',
              callId: callId,
              endTime: (event.startTime || performance.now()) + 1,
              result: null
            };
            
            enhancedEvents.push(afterEvent);
            
            console.log('✅ Created Locator event for:', actionName, selector);
          }
        }
      }
      
      // Write enhanced trace back to ZIP
      console.log('📝 Writing enhanced trace file...');
      const newZipFile = new yazl.ZipFile();
      
      // Add all original entries except trace.trace
      for (const [fileName, content] of entries) {
        if (fileName !== 'trace.trace') {
          newZipFile.addBuffer(content, fileName);
        }
      }
      
      // Add enhanced trace.trace
      const enhancedTraceContent = enhancedEvents.map(event => JSON.stringify(event)).join('\n');
      newZipFile.addBuffer(Buffer.from(enhancedTraceContent), 'trace.trace');
      
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
      
      console.log('✅ Post-processing completed - human actions should now support element highlighting!');
      return true;
      
    } catch (error) {
      console.log('❌ Post-processing failed:', error);
      return false;
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
