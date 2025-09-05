#!/usr/bin/env node

/**
 * Test for human action recording system with custom action names
 * Tests Playwright trace generation with element highlighting support
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import fs from 'fs';
import path from 'path';
import readline from 'readline'

async function startBrowserRecordingSession() {
  console.log('🎬 Starting Browser Recording Session \n');

  const client = new Client({ name: 'dual-output-test', version: '1.0.0' });
  
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['cli.js', '--save-trace-with-user-actions', '--record-user-actions', '--save-session'],
    cwd: process.cwd(),
    stdio: ['pipe', 'pipe', 'inherit'], // Allow stderr from server to show in console
  });

  try {
    await client.connect(transport);
    console.log('✅ Connected to MCP server with user action recording enabled');

    // Test 1: Verify tools are available
    console.log('🔧 Testing tool availability...');
    
    const tools = await client.listTools();
    const requiredTools = [
      'browser_start_user_session',
      'browser_end_user_session', 
      'browser_open_trace_viewer',
      'browser_list_session_logs'
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
    const startResult = await client.callTool({
      name: 'browser_start_user_session',
      arguments: { 
        filename: 'dual-output-test',
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
        filename: 'dual-output-test',
        closeAfter: false,
        actionName: 'User Click' // Custom name instead of "Bounding box"
      }
    });

    const endText = endResult.content[0].text;
    
    console.log('\n📁 Verifying output files...');
    
    let traceFile;
    
    const traceMatch = endText.match(/📦 Playwright trace\.zip: (.+)/);
    if (traceMatch) {
      traceFile = traceMatch[1];
      if (fs.existsSync(traceFile)) {
        const stats = fs.statSync(traceFile);
        console.log(`✅ Trace file exists: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
      } else {
        console.log('❌ Trace file not found at:', traceFile);
      }
    }

    if (traceFile && fs.existsSync(traceFile)) {
      console.log('\n🎭 Testing trace viewer tool...');
      
      // List available traces
      const traceListResult = await client.callTool({
        name: 'browser_open_trace_viewer',
        arguments: {}
      });
      
      const traceListText = traceListResult.content[0].text;
      if (traceListText.includes('Available Trace Files')) {
        console.log('✅ Trace viewer listing works');
      }
    } else {
      console.log('❌ Trace viewer didnt open...');
    }
  } catch (error) {
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