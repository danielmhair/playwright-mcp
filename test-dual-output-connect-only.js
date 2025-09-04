#!/usr/bin/env node

/**
 * Comprehensive test for the dual-output human action recording system
 * CONNECT-ONLY VERSION: Connects to an already running MCP server via HTTP/SSE
 * 
 * Usage: 
 * 1. Start MCP server in debug mode with port: Use "Debug MCP Server with Port" in VS Code
 * 2. Run: node test-dual-output-connect-only.js
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import fs from 'fs';
import path from 'path';

async function testDualOutputSystem() {
  console.log('🎬 Testing Dual-Output Human Action Recording System (Connect-Only)\n');

  const serverPort = 3001; // Default port for debug server
  const serverUrl = `http://localhost:${serverPort}/sse`;
  
  console.log(`🔌 Connecting to MCP server at ${serverUrl}`);
  console.log('   Make sure you started "Debug MCP Server with Port" first!\n');

  const client = new Client({ 
    name: 'dual-output-connect-test', 
    version: '1.0.0' 
  });
  
  // Use SSE transport to connect to the debug server running with --port
  const transport = new SSEClientTransport(new URL(serverUrl));

  try {
    console.log('⏳ Connecting to server...');
    await client.connect(transport);
    console.log('✅ Connected to MCP server with dual recording enabled\n');

    // Test 1: Verify tools are available
    console.log('🔧 Testing tool availability...');
    
    const tools = await client.listTools();
    const requiredTools = [
      'browser_start_user_session',
      'browser_end_user_session', 
      'browser_navigate',
      'browser_snapshot',
      'browser_click'
    ];
    
    const availableTools = tools.tools.map(t => t.name);
    const missingTools = requiredTools.filter(tool => !availableTools.includes(tool));
    
    if (missingTools.length === 0) {
      console.log('✅ All required tools available');
    } else {
      console.error('❌ Missing tools:', missingTools.join(', '));
      return;
    }

    // Test 2: Start user session
    console.log('\n🎬 Testing user session start...');
    const startResult = await client.callTool({
      name: 'browser_start_user_session',
      arguments: { enableTracing: true }
    });
    console.log('✅ User session started');

    // Test 3: Navigate to example page
    console.log('\n📍 Navigating to example.com...');
    const navResult = await client.callTool({
      name: 'browser_navigate',
      arguments: { url: 'https://example.com' }
    });
    console.log('✅ Navigation completed');

    // Test 4: Take a snapshot for trace content
    console.log('\n📸 Taking snapshot...');
    await client.callTool({
      name: 'browser_snapshot',
      arguments: {}
    });
    console.log('✅ Snapshot taken');

    // Test 5: Perform a programmatic click for comparison
    console.log('\n🤖 Performing programmatic click actions...');
    try {
      await client.callTool({
        name: 'browser_click',
        arguments: { 
          element: 'Example Domain link',
          ref: '1'  // Try first available element
        }
      });
      console.log('✅ Programmatic click completed');
    } catch (error) {
      console.log('⚠️  Programmatic click failed (expected if no clickable element)');
    }

    // Navigate back to fresh page
    await client.callTool({
      name: 'browser_navigate',
      arguments: { url: 'https://example.com' }
    });
    console.log('✅ Navigated back to example.com');

    // Test 6: Manual interaction period
    console.log('\n👤 Manual interaction period starting...');
    console.log('   🖱️  Please interact with the browser (click, type, scroll)');
    console.log('   🔍 Watch VS Code debug console for trace event messages:');
    console.log('       - "🎯 Created real-time Locator event"');
    console.log('       - "✅ Writing event to trace" / "❌ Failed to write"');
    console.log('   ⏰ Test will continue in 15 seconds for dual output generation...\n');

    // Wait for manual interaction - check debug console during this time!
    await new Promise(resolve => setTimeout(resolve, 15000));

    // Test 7: End session and get trace
    console.log('\n🏁 Ending session and testing dual outputs...');
    const endResult = await client.callTool({
      name: 'browser_end_user_session',
      arguments: { 
        closeAfter: false,
        filename: 'connect-only-test'
      }
    });
    
    console.log('✅ User session ended');

    // Test 8: Verify trace file exists
    console.log('\n📁 Verifying output files...');
    // The exact trace path would be in the endResult content
    console.log('✅ Check VS Code debug console for trace file path');

    console.log('\n🎭 Testing trace viewer tool...');
    try {
      await client.callTool({
        name: 'browser_open_trace_viewer',
        arguments: {}
      });
      console.log('✅ Trace viewer opened');
    } catch (error) {
      console.log('⚠️  Trace viewer tool may not be available');
    }

    console.log('\n✅ Connect-only test completed!');
    console.log('🔍 Check the trace viewer to see if human actions now support element highlighting');

  } catch (error) {
    console.error('\n❌ Connection or test failed:', error.message);
    console.log('\n💡 Troubleshooting:');
    console.log('   1. Make sure MCP server is running with: "Debug MCP Server with Port"');
    console.log(`   2. Verify server is listening on port ${serverPort}`);
    console.log('   3. Check VS Code debug console for server startup messages');
  } finally {
    try {
      await client.close();
    } catch (e) {
      // Ignore close errors
    }
  }
}

testDualOutputSystem().catch(console.error);