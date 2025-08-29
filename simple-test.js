#!/usr/bin/env node

/**
 * Simple test for user session functionality
 * Run this after starting the MCP server in another terminal
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

async function simpleTest() {
  console.log('🚀 Testing user session tools...\n');

  const client = new Client({ name: 'simple-test', version: '1.0.0' });
  
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['lib/program.js', '--save-trace-with-user-actions', '--browser=chromium'],
    cwd: process.cwd(),
  });

  try {
    await client.connect(transport);
    console.log('✅ Connected to MCP server');

    // Navigate first
    console.log('\n📍 Navigating to example.com...');
    const nav = await client.callTool({
      name: 'browser_navigate',
      arguments: { url: 'https://example.com' }
    });
    console.log('✅ Navigation completed');

    // Start user session
    console.log('\n🎬 Starting user session...');
    const start = await client.callTool({
      name: 'browser_start_user_session',
      arguments: { enableTracing: true }
    });
    
    const startText = start.content[0].text;
    console.log('Start result:', startText.split('\n').filter(line => line.trim() && !line.startsWith('###')).join(' '));

    // Simple pause for manual interaction
    console.log('\n👤 Browser should now be open!');
    console.log('   🖱️  Click around in the browser window');
    console.log('   ⏰ Test will continue automatically in 10 seconds...\n');
    
    await new Promise(resolve => setTimeout(resolve, 10000));

    // End session
    console.log('🏁 Ending user session...');
    const end = await client.callTool({
      name: 'browser_end_user_session',
      arguments: { 
        filename: 'simple-test-trace',
        closeAfter: false
      }
    });

    const endText = end.content[0].text;
    console.log('\n📋 Session ended:');
    endText.split('\n').forEach(line => {
      if (line.trim() && !line.startsWith('###')) {
        console.log('   ', line);
      }
    });

    if (endText.includes('.zip')) {
      console.log('\n🎉 SUCCESS! Trace file created!');
      console.log('📁 Browser window should still be open - close it manually when done');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.close();
    console.log('\n✅ Test completed!');
  }
}

simpleTest().catch(console.error);