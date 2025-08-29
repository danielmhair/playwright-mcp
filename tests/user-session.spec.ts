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

import { test, expect } from './fixtures.js';

test.describe('User Session Recording', () => {
  test('should start and end user session recording', async ({ startClient }) => {
    const { client } = await startClient({
      args: ['--save-trace-with-user-actions']
    });

    // Navigate to a page first
    const navigateResponse = await client.callTool({
      name: 'browser_navigate',
      arguments: { url: 'https://example.com' }
    });

    expect(navigateResponse).toHaveResponse({
      result: expect.stringContaining('Navigated to https://example.com')
    });

    // Start user session recording
    const startResponse = await client.callTool({
      name: 'browser_start_user_session',
      arguments: { enableTracing: true }
    });

    expect(startResponse).toHaveResponse({
      result: expect.stringContaining('User session recording started')
    });

    // End user session recording
    const endResponse = await client.callTool({
      name: 'browser_end_user_session',
      arguments: { closeAfter: false }
    });

    expect(endResponse).toHaveResponse({
      result: expect.stringContaining('User session recording ended')
    });
  });

  test('should fail to end session if not started', async ({ startClient }) => {
    const { client } = await startClient();

    // Try to end session without starting it
    const endResponse = await client.callTool({
      name: 'browser_end_user_session',
      arguments: {}
    });

    expect(endResponse).toHaveResponse({
      result: expect.stringContaining('No active user session'),
      isError: true
    });
  });

  test('should support record user actions without trace generation', async ({ startClient }) => {
    const { client } = await startClient({
      args: ['--record-user-actions']
    });

    // Navigate to a page first
    await client.callTool({
      name: 'browser_navigate',
      arguments: { url: 'https://example.com' }
    });

    // Start user session recording without tracing
    const startResponse = await client.callTool({
      name: 'browser_start_user_session',
      arguments: { enableTracing: false }
    });

    expect(startResponse).toHaveResponse({
      result: expect.stringContaining('User session recording started')
    });

    // End user session recording
    const endResponse = await client.callTool({
      name: 'browser_end_user_session',
      arguments: {}
    });

    expect(endResponse).toHaveResponse({
      result: expect.stringContaining('User session recording ended')
    });
  });

  test('should close browser after ending session when requested', async ({ startClient }) => {
    const { client } = await startClient({
      args: ['--save-trace-with-user-actions']
    });

    // Navigate to a page first
    await client.callTool({
      name: 'browser_navigate',
      arguments: { url: 'https://example.com' }
    });

    // Start user session recording
    await client.callTool({
      name: 'browser_start_user_session',
      arguments: {}
    });

    // End user session recording and close browser
    const endResponse = await client.callTool({
      name: 'browser_end_user_session',
      arguments: { closeAfter: true }
    });

    expect(endResponse).toHaveResponse({
      result: expect.stringContaining('User session recording ended')
    });

    expect(endResponse).toHaveResponse({
      result: expect.stringContaining('Browser context closed')
    });
  });

  test('should support custom trace filename', async ({ startClient }) => {
    const { client } = await startClient({
      args: ['--save-trace-with-user-actions']
    });

    // Navigate to a page first
    await client.callTool({
      name: 'browser_navigate',
      arguments: { url: 'https://example.com' }
    });

    // Start user session recording
    await client.callTool({
      name: 'browser_start_user_session',
      arguments: {}
    });

    // End user session recording with custom filename
    const customFilename = 'my-test-session';
    const endResponse = await client.callTool({
      name: 'browser_end_user_session',
      arguments: { filename: customFilename }
    });

    expect(endResponse).toHaveResponse({
      result: expect.stringContaining('User session recording ended')
    });

    expect(endResponse).toHaveResponse({
      result: expect.stringContaining(`${customFilename}.zip`)
    });
  });
});