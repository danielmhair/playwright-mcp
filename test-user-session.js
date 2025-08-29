#!/usr/bin/env node

/**
 * Quick test script for user session recording functionality
 */

import { spawn } from 'child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

async function testUserSession() {
  console.log('🚀 Starting Playwright MCP user session test...\n');

  // Create MCP client that connects to the server
  const client = new Client({ name: 'test-user-session', version: '1.0.0' });
  
  // Create transport to connect to the running server via a new process
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['cli.js', '--save-trace-with-user-actions'],
    cwd: process.cwd(),
  });

  try {
    // Connect to the server
    await client.connect(transport);
    console.log('✅ Connected to MCP server');

    // Test 1: Navigate to a page
    console.log('\n📍 Step 1: Navigating to example.com...');
    const navigateResponse = await client.callTool({
      name: 'browser_navigate',
      arguments: { url: 'https://example.com' }
    });
    console.log('Navigate result:', navigateResponse.content[0].text.split('\n')[0]);

    // Test 2: Start user session recording
    console.log('\n🎬 Step 2: Starting user session recording...');
    const startResponse = await client.callTool({
      name: 'browser_start_user_session',
      arguments: { enableTracing: true }
    });
    console.log('Start session result:', startResponse.content[0].text.split('\n')[0]);

    // Test 3: Take a snapshot (this simulates some activity)
    console.log('\n📸 Step 3: Taking snapshot (simulating activity)...');
    const snapshotResponse = await client.callTool({
      name: 'browser_snapshot',
      arguments: {}
    });
    console.log('Snapshot taken successfully');

    // Test 4: Wait for human interaction
    console.log('\n👤 Step 4: Browser is now open for manual interaction!');
    console.log('   🖱️  Click around, type, navigate, etc. in the browser window');
    console.log('   ⌨️  Press ENTER in this terminal when you\'re done interacting...');
    
    // Wait for user to press Enter (compatible approach)
    const readline = await import('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    await new Promise(resolve => {
      rl.question('', () => {
        rl.close();
        resolve();
      });
    });

    // Test 5: End user session and get trace
    console.log('\n🏁 Step 5: Ending user session and retrieving trace...');
    const endResponse = await client.callTool({
      name: 'browser_end_user_session',
      arguments: { 
        filename: 'test-session-trace',
        closeAfter: false  // Let human close the browser manually
      }
    });
    
    console.log('\n📝 Note: The browser is still open. Close it manually when you\'re done reviewing.');
    
    const endResult = endResponse.content[0].text;
    console.log('End session results:');
    endResult.split('\n').forEach(line => {
      if (line.trim()) console.log('  ', line);
    });

    // Check if trace file was created
    if (endResult.includes('.zip')) {
      console.log('\n🎉 SUCCESS! Trace file created successfully!');
      console.log('📁 Check the output directory for your trace.zip file');
    }

    // Check for attachments (the trace file)
    if (endResponse.content.length > 1) {
      console.log(`\n📎 Trace file attachment received (${endResponse.content.length - 1} attachment(s))`);
    }

  } catch (error) {
    console.error('❌ Error during test:', error.message);
  } finally {
    // Clean up
    console.log('\n🧹 Cleaning up...');
    await client.close();
    console.log('✅ Test completed!');
  }
}

// Handle process cleanup
process.on('SIGINT', () => {
  console.log('\n👋 Test interrupted');
  process.exit(0);
});

process.on('uncaughtException', (error) => {
  console.error('\n💥 Uncaught exception:', error.message);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('\n💥 Unhandled rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Run the test
testUserSession().catch(error => {
  console.error('💥 Test failed:', error);
  process.exit(1);
});