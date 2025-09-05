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
import { z } from 'zod';
import { defineTool } from './tool.js';

export const browserStartUserSession = defineTool({
  capability: 'core',
  schema: {
    name: 'browser_start_user_session',
    title: 'Start user session recording',
    description: 'Start recording human user actions in the browser session. This enables capturing manual interactions performed by users for trace generation.',
    inputSchema: z.object({
      enableTracing: z.boolean().default(true).describe('Whether to enable trace recording for user actions'),
    }),
    type: 'destructive',
  },
  handle: async (context, params, response) => {
    const tab = await context.ensureTab();

    // Enable input recorder to capture human actions
    await context.setInputRecorderEnabled(true);

    // Mark that user session is active
    context.setUserSessionActive(true);

    if (params.enableTracing && (context.config.saveTrace || context.config.saveTraceWithUserActions)) {
      try {
        // Add marker to trace indicating user session started
        const browserContext = await context._getBrowserContextForTracing();
        if (browserContext) {
          await browserContext.tracing.group('User Session Started', {
            location: { file: 'user-session' }
          });
          await browserContext.tracing.groupEnd();
        }
      } catch (error) {
        response.addError(`Failed to add trace marker: ${error}`);
        return;
      }
    }

    response.addResult('User session recording started. Browser is now ready for manual interaction.');
    response.addResult('');
    response.addResult('📊 RECORDING SYSTEM:');
    response.addResult('   1. Playwright trace.zip → Screenshots, network, human actions with element highlighting');
    response.addResult('   2. Custom action names → Configurable display names in trace viewer');
    response.addResult(`Current page: ${tab.page.url()}`);

    // Check if browser is headless and warn user
    if (context.config.browser.launchOptions.headless) {
      response.addResult('⚠️  WARNING: Browser is running in headless mode. Human interactions cannot be performed.');
      response.addResult('   To enable manual interaction, restart without --headless flag.');
    } else {
      response.addResult('✅ Browser is running in headed mode - you can now perform manual interactions.');
    }

    if (context.config.saveTraceWithUserActions || context.config.recordUserActions)
      response.addResult('Human actions will be recorded and can be retrieved using browser_end_user_session.');

  },
});

export const browserEndUserSession = defineTool({
  capability: 'core',
  schema: {
    name: 'browser_end_user_session',
    title: 'End user session recording',
    description: 'End user action recording session and retrieve trace file containing all human interactions.',
    inputSchema: z.object({
      closeAfter: z.boolean().default(false).describe('Whether to close the browser after ending the session'),
      filename: z.string().optional().describe('Custom filename for the trace file (without extension)'),
      actionName: z.string().default('Human Action').describe('Custom name for human actions in trace viewer (replaces "Bounding box")'),
    }),
    type: 'destructive',
  },
  handle: async (context, params, response) => {
    if (!context.isUserSessionActive()) {
      response.addError('No active user session. Start a user session first using browser_start_user_session.');
      return;
    }

    try {
      // Force flush any pending actions from the input recorder
      await context.flushInputRecorder();

      // Add session end marker to trace
      if (context.config.saveTrace || context.config.saveTraceWithUserActions) {
        const browserContext = await context._getBrowserContextForTracing();
        if (browserContext) {
          await browserContext.tracing.group('User Session Ended', {
            location: { file: 'user-session' }
          });
          await browserContext.tracing.groupEnd();
        }
      }

      let traceFile: string | undefined;

      // Generate trace file if tracing is enabled
      if (context.config.saveTrace || context.config.saveTraceWithUserActions) {
        try {
          const traceName = params.filename || `user-session-${Date.now()}`;
          traceFile = await context.createUserSessionTrace(traceName);

          if (traceFile && fs.existsSync(traceFile)) {
            // POST-PROCESS TRACE FILE: Rename "Bounding box" entries to custom action name
            const postProcessed = await context.postProcessTraceFile(traceFile, params.actionName);
            const statusMessage = postProcessed
              ? `User session trace saved with custom action names ("${params.actionName}")`
              : 'User session trace saved (post-processing failed)';

            response.addResult(`${statusMessage}: ${traceFile}`);

            // Add trace file as image attachment (since Response doesn't have addAttachment)
            const traceData = await fs.promises.readFile(traceFile);
            response.addImage({
              data: traceData,
              contentType: 'application/zip',
            });
          } else {
            response.addResult('Trace file was not created or is not accessible.');
          }
        } catch (error) {
          response.addError(`Failed to create trace file: ${error}`);
        }
      }

      // Mark user session as inactive
      context.setUserSessionActive(false);

      // Disable input recorder unless configuration requires it to stay on
      if (!context.config.recordUserActions)
        await context.setInputRecorderEnabled(false);


      response.addResult('User session recording ended.');

      if (traceFile) {
        response.addResult(`📦 Playwright trace.zip: ${traceFile}`);
        response.addResult('   - Contains: Screenshots, network logs, browser state');
        response.addResult('   - View with: npx playwright show-trace <file>');
        response.addResult('');
        response.addResult('📝 Session .md log: Available in session log directory');
        response.addResult('   - Contains: Detailed human interaction timeline');
        response.addResult('   - Shows: Every click, type, scroll with timestamps');
      }

      // Close browser if requested
      if (params.closeAfter) {
        await context.closeBrowserContext();
        response.addResult('Browser context closed.');
      }

    } catch (error) {
      response.addError(`Failed to end user session: ${error}`);
      // Ensure session state is cleaned up even on error
      context.setUserSessionActive(false);
    }
  },
});

export default [browserStartUserSession, browserEndUserSession];
