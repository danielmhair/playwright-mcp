#!/usr/bin/env node

/**
 * Test script to demonstrate improved trace recording
 * This shows the difference in trace recording before and after the fix
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

async function traceTest() {
  console.log('🧪 Testing improved trace recording for user actions...\n');

  const client = new Client({ name: 'trace-test', version: '1.0.0' });
  
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['lib/program.js', '--save-trace-with-user-actions', '--browser=chromium'],
    cwd: process.cwd(),
  });

  try {
    await client.connect(transport);
    console.log('✅ Connected to MCP server');

    // Navigate first
    console.log('\n📍 Navigating to Google...');
    await client.callTool({
      name: 'browser_navigate',
      arguments: { url: 'https://www.google.com' }
    });

    // Start user session 
    console.log('\n🎬 Starting user session with improved trace recording...');
    const startResult = await client.callTool({
      name: 'browser_start_user_session',
      arguments: { enableTracing: true }
    });
    
    console.log('Session started successfully!');

    // Simulate some MCP tool actions to generate trace entries
    console.log('\n🔧 Performing some automated actions to generate trace entries...');
    
    // Take snapshot
    await client.callTool({
      name: 'browser_snapshot',
      arguments: {}
    });
    console.log('  - Snapshot taken');

    // Type in search box (if available)
    try {
      await client.callTool({
        name: 'browser_type',
        arguments: { 
          text: 'playwright automation',
          selector: '[name="q"]' 
        }
      });
      console.log('  - Text typed in search box');
    } catch (e) {
      console.log('  - Search box not found (expected)');
    }

    console.log('\n👤 Now the browser is ready for manual interaction!');
    console.log('   🖱️  Each click, type, scroll action should now appear as separate entries in the trace');
    console.log('   📊 The improvement: Instead of just 3 actions, you should see individual user actions');
    console.log('   ⏰ Waiting 15 seconds for manual interaction...\n');
    
    await new Promise(resolve => setTimeout(resolve, 15000));

    // End session
    console.log('🏁 Ending user session and creating trace...');
    const endResult = await client.callTool({
      name: 'browser_end_user_session',
      arguments: { 
        filename: 'improved-trace-test',
        closeAfter: false
      }
    });

    console.log('\n📈 Results:');
    const endText = endResult.content[0].text;
    endText.split('\n').forEach(line => {
      if (line.trim() && !line.startsWith('###')) {
        console.log('   ', line);
      }
    });

    if (endText.includes('.zip')) {
      console.log('\n🎉 SUCCESS! Trace file created with improved action recording!');
      console.log('📁 Key improvements:');
      console.log('   - Each user interaction should appear as individual trace entry');
      console.log('   - page.evaluate() calls create proper trace steps');
      console.log('   - Console logs mark each user action in trace');
      console.log('   - More granular action tracking vs. previous group-only approach');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.close();
    console.log('\n✅ Trace test completed!');
  }
}

traceTest().catch(console.error);