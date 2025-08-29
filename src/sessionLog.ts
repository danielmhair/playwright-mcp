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

import fs from 'fs';
import path from 'path';

import { outputFile  } from './config.js';
import { Response } from './response.js';
import type { FullConfig } from './config.js';
import type * as actions from './actions.js';
import type { Tab } from './tab.js';

export type Action = actions.ActionInContext & { code: string; tab?: Tab | undefined; timestamp: number };

export class SessionLog {
  private _folder: string;
  private _file: string;
  private _ordinal = 0;
  private _lastModified = 0;

  constructor(sessionFolder: string) {
    this._folder = sessionFolder;
    this._file = path.join(this._folder, 'session.md');
  }

  static async create(config: FullConfig): Promise<SessionLog> {
    const sessionFolder = await outputFile(config, `session-${Date.now()}`);
    await fs.promises.mkdir(sessionFolder, { recursive: true });
    // eslint-disable-next-line no-console
    console.error(`Session: ${sessionFolder}`);
    
    const sessionLog = new SessionLog(sessionFolder);
    await sessionLog._initializeSessionHeader(config);
    return sessionLog;
  }

  private async _initializeSessionHeader(config: FullConfig) {
    const header = [
      '# 🎬 Playwright MCP Session Recording',
      '',
      '## 📊 Dual Recording System',
      '',
      'This session provides **two complementary outputs**:',
      '',
      '### 1. 📦 Playwright Trace (.zip)',
      '- **Contains:** Screenshots, network logs, browser state snapshots',
      '- **Purpose:** Visual debugging with timeline view',
      '- **View with:** `npx playwright show-trace <trace-file.zip>`',
      '- **Best for:** Understanding page states, network activity, visual changes',
      '',
      '### 2. 📝 Session Log (.md)',
      '- **Contains:** Detailed human interaction timeline (this file)',
      '- **Purpose:** Complete action-by-action breakdown',
      '- **View with:** Any markdown viewer or text editor',
      '- **Best for:** Understanding user behavior, action sequences, debugging interactions',
      '',
      '---',
      '',
      `**Session Started:** ${new Date().toLocaleString()}`,
      `**Browser:** ${config.browser.browserName || 'Unknown'}`,
      `**Headless:** ${config.browser.launchOptions.headless ? 'Yes' : 'No'}`,
      `**User Actions Recording:** ${config.recordUserActions ? 'Enabled' : 'Disabled'}`,
      `**Trace Recording:** ${config.saveTrace || config.saveTraceWithUserActions ? 'Enabled' : 'Disabled'}`,
      '',
      '---',
      '',
    ];
    
    await this._appendLines(header);
  }

  lastModified() {
    return this._lastModified;
  }

  async logResponse(response: Response) {
    this._lastModified = performance.now();
    const prefix = `${(++this._ordinal).toString().padStart(3, '0')}`;
    const lines: string[] = [
      `### Tool call: ${response.toolName}`,
      `- Args`,
      '```json',
      JSON.stringify(response.toolArgs, null, 2),
      '```',
    ];
    if (response.result()) {
      lines.push(
          response.isError() ? `- Error` : `- Result`,
          '```',
          response.result(),
          '```');
    }

    if (response.code()) {
      lines.push(
          `- Code`,
          '```js',
          response.code(),
          '```');
    }

    const snapshot = await response.snapshot();
    if (snapshot?.tabSnapshot) {
      const fileName = `${prefix}.snapshot.yml`;
      await fs.promises.writeFile(path.join(this._folder, fileName), snapshot.tabSnapshot?.ariaSnapshot);
      lines.push(`- Snapshot: ${fileName}`);
    }

    for (const image of response.images()) {
      const fileName = `${prefix}.screenshot.${extension(image.contentType)}`;
      await fs.promises.writeFile(path.join(this._folder, fileName), image.data);
      lines.push(`- Screenshot: ${fileName}`);
    }

    lines.push('', '', '');
    await this._appendLines(lines);
  }

  async logActions(actions: Action[]) {
    // Skip recent navigation, it is a side-effect of the previous action or tool use.
    if (actions?.[0]?.action?.name === 'navigate' && actions[0].timestamp - this._lastModified < 1000)
      return;

    this._lastModified = performance.now();
    const lines: string[] = [];
    
    // Enhanced human interaction timeline
    if (actions.length > 0) {
      lines.push('---', '## 🎯 Human Interaction Timeline', '');
    }
    
    for (const action of actions) {
      const prefix = `${(++this._ordinal).toString().padStart(3, '0')}`;
      const timestamp = new Date(action.startTime || Date.now()).toLocaleTimeString();
      const duration = action.endTime && action.startTime ? 
        `(${Math.round(action.endTime - action.startTime)}ms)` : '';
      
      // Enhanced action header with timing and context
      lines.push(`### ${prefix}. [${timestamp}] ${this._formatActionName(action.action.name)} ${duration}`);
      
      // Action details with enhanced formatting
      this._addActionDetails(lines, action);
      
      // Element information - check if action has selector property
      if ('selector' in action.action && action.action.selector) {
        lines.push(`**Target Element:** \`${action.action.selector}\``);
      }
      
      // Action-specific data
      this._addActionSpecificData(lines, action);
      
      // Generated code
      if (action.code) {
        lines.push('', '**Generated Code:**');
        lines.push('```javascript', action.code, '```');
      }
      
      // Page snapshot if available
      if (action.action.ariaSnapshot) {
        const fileName = `${prefix}.snapshot.yml`;
        await fs.promises.writeFile(path.join(this._folder, fileName), action.action.ariaSnapshot);
        lines.push('', `**Page Snapshot:** [${fileName}](${fileName})`);
      }
      
      lines.push('', '---', '');
    }

    await this._appendLines(lines);
  }

  private _formatActionName(name: string): string {
    const actionIcons = {
      'click': '🖱️ Click',
      'fill': '⌨️ Fill',
      'press': '⌨️ Key Press',
      'navigate': '🌐 Navigate',
      'select': '📋 Select',
      'check': '✅ Check',
      'uncheck': '⬜ Uncheck',
      'setInputFiles': '📁 Upload Files',
      'assertText': '🔍 Verify Text',
      'assertValue': '🔍 Verify Value',
      'assertChecked': '🔍 Verify Checked',
      'assertVisible': '👁️ Verify Visible',
      'closePage': '❌ Close Page',
      'openPage': '🆕 Open Page'
    };
    return actionIcons[name as keyof typeof actionIcons] || `🔧 ${name}`;
  }

  private _addActionDetails(lines: string[], action: Action) {
    const details = [];
    
    if (action.tab) {
      details.push(`**Tab:** ${action.tab.page.url()}`);
    }
    
    if (action.frame && 'name' in action.frame && action.frame.name) {
      details.push(`**Frame:** ${action.frame.name}`);
    }
    
    if (details.length > 0) {
      lines.push('', ...details);
    }
  }

  private _addActionSpecificData(lines: string[], action: Action) {
    const actionData = action.action;
    
    switch (actionData.name) {
      case 'click':
        if ('button' in actionData && actionData.button) lines.push(`**Button:** ${actionData.button}`);
        if ('modifiers' in actionData && Array.isArray(actionData.modifiers) && actionData.modifiers.length) lines.push(`**Modifiers:** ${actionData.modifiers.join(', ')}`);
        if ('clickCount' in actionData && actionData.clickCount && actionData.clickCount > 1) lines.push(`**Click Count:** ${actionData.clickCount}`);
        break;
        
      case 'fill':
        if ('text' in actionData && actionData.text) lines.push(`**Text Entered:** "${actionData.text}"`);
        break;
        
      case 'press':
        if ('key' in actionData && actionData.key) lines.push(`**Key:** ${actionData.key}`);
        break;
        
      case 'navigate':
        if ('url' in actionData && actionData.url) lines.push(`**URL:** ${actionData.url}`);
        break;
        
      case 'select':
        if ('options' in actionData && actionData.options) lines.push(`**Selected Options:** ${actionData.options.join(', ')}`);
        break;
        
      case 'setInputFiles':
        if ('files' in actionData && actionData.files) lines.push(`**Files:** ${actionData.files.join(', ')}`);
        break;
        
      case 'assertText':
        if ('text' in actionData && actionData.text) lines.push(`**Expected Text:** "${actionData.text}"`);
        break;
        
      case 'assertValue':
        if ('text' in actionData && actionData.text) lines.push(`**Expected Value:** "${actionData.text}"`);
        break;
    }
  }

  private async _appendLines(lines: string[]) {
    await fs.promises.appendFile(this._file, lines.join('\n'));
  }
}

function extension(contentType: string): 'jpg' | 'png' {
  if (contentType === 'image/jpeg')
    return 'jpg';
  return 'png';
}
