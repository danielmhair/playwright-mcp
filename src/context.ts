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
        // Only record to trace, don't interfere with user actions
        void this._recordTraceStep(data.action.name || code.trim(), page, data);
        this._scheduleFlush();
      },
      actionUpdated: (page: playwright.Page, data: actions.ActionInContext, code: string) => {
        if (!this._enabled)
          return;
        const tab = Tab.forPage(page);
        this._actions[this._actions.length - 1] = { ...data, tab, code: code.trim(), timestamp: performance.now() };
        // Only record to trace, don't interfere with user actions
        void this._recordTraceStep(data.action.name || code.trim(), page, data);
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
        void this._recordTraceStep(`await page.goto('${data.signal.url}');`, page, data);
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

  private async _recordTraceStep(title: string, page?: playwright.Page, actionData?: any) {
    // ARCHITECTURAL SOLUTION: Use Playwright's native tracing.group() API
    //
    // This approach uses Playwright's official API for custom trace entries
    // - Uses browserContext.tracing.group() with rich metadata
    // - Appears natively in trace viewer timeline
    // - No hacking or brittle workarounds
    // - Maintains trace integrity

    if (!actionData || !this._browserContext)
      return;


    try {
      const browserContext = this._browserContext;

      // Create trace group for human action with embedded metadata
      const actionType = actionData.action?.name || 'unknown';
      const selector = actionData.action?.selector || '';
      const pageUrl = page?.url() || '';
      const timestamp = new Date().toISOString();
      const button = actionData.action?.button ? ` [${actionData.action.button}]` : '';
      const text = actionData.action?.text ? ` "${actionData.action.text}"` : '';

      // Embed all metadata in the title for trace viewer visibility
      const traceTitle = `👤 Human ${actionType}${button}${text} → ${selector} | ${pageUrl} | ${timestamp}`;

      await browserContext.tracing.group(traceTitle, {
        location: {
          file: 'human-action',
          line: Date.now(),
          column: 0
        }
      });

      await browserContext.tracing.groupEnd();

    } catch (error) {
      // Fail silently to not interfere with user actions
      console.debug('Failed to record trace step:', error);
    }
  }
}
