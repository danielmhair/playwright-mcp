#!/usr/bin/env node

/**
 * Test script specifically for the trace recording fix
 * Tests the new replay mechanism for user actions
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

async function testTraceFix() {
  console.log('🧪 Testing trace recording fix for individual user actions...\n');

  const client = new Client({ name: 'trace-fix-test', version: '1.0.0' });
  
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['lib/program.js', '--save-trace-with-user-actions', '--browser=chromium', '--record-user-actions'],
    cwd: process.cwd(),
  });

  try {
    await client.connect(transport);
    console.log('✅ Connected to MCP server with user action recording enabled');

    // Navigate to a simple test page
    console.log('\n📍 Navigating to a test page...');
    await client.callTool({
      name: 'browser_navigate',
      arguments: { url: 'https://example.com' }
    });
    console.log('✅ Navigation completed');

    // Start user session 
    console.log('\n🎬 Starting user session with enhanced trace recording...');
    const startResult = await client.callTool({
      name: 'browser_start_user_session',
      arguments: { enableTracing: true }
    });
    console.log('✅ User session started');

    // Perform some programmatic actions to generate trace entries
    console.log('\n🤖 Performing programmatic actions (should appear in trace):');
    
    // Take snapshot
    await client.callTool({
      name: 'browser_snapshot',
      arguments: {}
    });
    console.log('  ✅ Snapshot taken');

    // Click something if available
    try {
      await client.callTool({
        name: 'browser_click',
        arguments: { selector: 'body' }
      });
      console.log('  ✅ Click action performed');
    } catch (e) {
      console.log('  ℹ️  Click action skipped (element not found)');
    }

    console.log('\n👤 THE KEY TEST: Now manually interact with the browser!');
    console.log('   🖱️  Click on different parts of the page');
    console.log('   ⌨️  Type some text if there are input fields');
    console.log('   📜 Scroll the page up and down');
    console.log('   🔗 Try clicking any links');
    console.log('');
    console.log('💡 The fix should now:');
    console.log('   - Record each interaction as a separate action');
    console.log('   - Create trace entries via replay mechanism');
    console.log('   - Show individual actions in trace timeline');
    console.log('');
    console.log('⏰ Test will continue in 20 seconds...');
    
    await new Promise(resolve => setTimeout(resolve, 20000));

    // End session and create trace
    console.log('\n🏁 Ending user session and creating enhanced trace...');
    const endResult = await client.callTool({
      name: 'browser_end_user_session',
      arguments: { 
        filename: 'enhanced-trace-fix-test',
        closeAfter: false
      }
    });

    console.log('\n📊 Enhanced Trace Results:');
    const endText = endResult.content[0].text;
    endText.split('\n').forEach(line => {
      if (line.trim() && !line.startsWith('###')) {
        console.log('   ', line);
      }
    });

    if (endText.includes('.zip')) {
      console.log('\n🎉 SUCCESS! Enhanced trace file created!');
      console.log('');
      console.log('🔍 KEY IMPROVEMENTS TO VERIFY:');
      console.log('   1. Open the trace file in Playwright trace viewer');
      console.log('   2. Check the Actions panel on the left');
      console.log('   3. You should now see MORE than just 3 actions');
      console.log('   4. Each user interaction should appear as individual entries');
      console.log('   5. Look for hover actions and evaluate calls from the replay mechanism');
      console.log('');
      console.log('🐛 If still only 3 actions appear:');
      console.log('   - The replay mechanism might need refinement');
      console.log('   - User actions might not be triggering the InputRecorder properly');
      console.log('   - Trace recording might need different integration approach');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.close();
    console.log('\n✅ Enhanced trace test completed!');
  }
}

testTraceFix().catch(console.error);