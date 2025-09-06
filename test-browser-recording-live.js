#!/usr/bin/env node

/**
 * Test for human action recording system with custom action names
 * Tests Playwright trace generation with element highlighting support
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import fs from 'fs';
import readline from 'readline';
import { spawn } from 'child_process';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

async function startBrowserRecordingSession() {
  console.log('🎬 Starting Browser Recording Session \n');

  const client = new Client({ name: 'browser-recorder', version: '1.0.0' });
  
  const transport = new SSEClientTransport(new URL('http://localhost:3001/sse'))

  try {
    await client.connect(transport);
    console.log('✅ Connected to MCP server with user action recording enabled');

    // Test 1: Verify tools are available
    console.log('🔧 Testing tool availability...');
    
    const tools = await client.listTools();
    const requiredTools = [
      'browser_start_user_session',
      'browser_end_user_session', 
    ];
    
    const availableTools = tools.tools.map(t => t.name);
    const missingTools = requiredTools.filter(tool => !availableTools.includes(tool));
    
    if (missingTools.length === 0) {
      console.log('✅ All required tools available in MCP Server');
    } else {
      console.error('❌ Missing tools:', missingTools.join(', '));
      return;
    }

    console.log('📝 Triggering Playwright MCP Server to record a browser session');
    await client.callTool({
      name: 'browser_start_user_session',
      arguments: { 
        filename: 'trace',
        closeAfter: false
      }
    });

    await client.callTool({
      name: 'browser_navigate',
      arguments: { url: 'https://google.com' }
    });

    console.log('👤 Interact with the browser!');
    await waitForEnter()

    console.log('🏁 Ending session and testing trace generation...');
    
    const endResult = await client.callTool({
      name: 'browser_end_user_session',
      arguments: { 
        filename: 'trace',
        closeAfter: false,
        actionName: 'Manual Interaction' // Fallback name for unmatched actions
      }
    });

    const endText = endResult.content[0].text;
    
    const traceMatch = endText.match(/📦 Playwright trace\.zip: (.+)/);
    if (traceMatch) {
      const traceFile = traceMatch[1];
      if (fs.existsSync(traceFile)) {
        const stats = fs.statSync(traceFile);
        console.log(`📁 Trace file exists: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
        
        // Automatically open Playwright trace viewer
        console.log('🎭 Opening Playwright trace viewer...');
        
        const traceViewer = spawn('npx', ['playwright', 'show-trace', traceFile], {
          stdio: 'inherit',
          shell: true,
          detached: true
        });
        
        // Don't wait for the trace viewer to close
        traceViewer.unref();
        
        console.log(`📊 Trace viewer command: npx playwright show-trace "${traceFile}"`);
      } else {
        console.log('❌ Trace file not found at:', traceFile);
      }
    }
  } catch (error) {
    console.error(error)
    console.error('❌ Test error:', error.message);
  } finally {
    await client.close();
    console.log('\n✅ User action recording test completed!');
  }
}



async function waitForEnter() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    rl.question('Press Enter to continue...', () => {
      rl.close();
      resolve();
    });
  });
}

startBrowserRecordingSession().catch(console.error);