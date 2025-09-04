#!/usr/bin/env node

/**
 * Comprehensive test for the dual-output human action recording system
 * Tests both Playwright trace generation and enhanced session logging
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import fs from 'fs';
import path from 'path';

async function testDualOutputSystem() {
  console.log('🎬 Testing Dual-Output Human Action Recording System\n');

  const client = new Client({ name: 'dual-output-test', version: '1.0.0' });
  
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['cli.js', '--save-trace-with-user-actions', '--record-user-actions', '--save-session'],
    cwd: process.cwd(),
    stdio: ['pipe', 'pipe', 'inherit'], // Allow stderr from server to show in console
  });

  try {
    await client.connect(transport);
    console.log('✅ Connected to MCP server with dual recording enabled');

    // Test 1: Verify tools are available
    console.log('\n🔧 Testing tool availability...');
    
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
      console.log('✅ All required tools available');
    } else {
      console.error('❌ Missing tools:', missingTools.join(', '));
      return;
    }

    // Test 2: Start user session
    console.log('\n🎬 Testing user session start...');
    
    // Navigate first
    console.log('📍 Navigating to example.com...');
    try {
      const navResult = await client.callTool({
        name: 'browser_navigate',
        arguments: { url: 'https://example.com' }
      });
      console.log('✅ Navigation completed:', navResult.content[0].text.split('\n')[0]);
    } catch (error) {
      console.error('❌ Navigation failed:', error.message);
      return;
    }
    
    try {
      const startResult = await client.callTool({
        name: 'browser_start_user_session',
        arguments: { enableTracing: true }
      });
      
      const startText = startResult.content[0].text;
      console.log('✅ Session start result received');
      
      if (startText.includes('DUAL RECORDING SYSTEM')) {
        console.log('✅ User session started with dual recording messaging');
      } else {
        console.log('⚠️  Session started but missing dual recording messaging');
        console.log('Response:', startText.split('\n')[0]);
      }
    } catch (error) {
      console.error('❌ Session start failed:', error.message);
      return;
    }

    // Test 3: Simulate some programmatic actions for trace
    console.log('\n🤖 Performing programmatic actions for trace content...');
    
    await client.callTool({
      name: 'browser_snapshot',
      arguments: {}
    });
    console.log('✅ Snapshot taken');

    // Test 3b: Add some programmatic clicks to compare with human actions
    console.log('🤖 Performing programmatic click actions...');
    
    try {
      // Click on the "More information..." link programmatically
      const clickResult = await client.callTool({
        name: 'browser_click',
        arguments: { 
          selector: 'text=More information...',
          timeout: 5000
        }
      });
      console.log('✅ Programmatic click completed');
      
      // Wait a moment then go back to example.com
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      await client.callTool({
        name: 'browser_navigate',
        arguments: { url: 'https://example.com' }
      });
      console.log('✅ Navigated back to example.com');
      
    } catch (error) {
      console.log('⚠️  Programmatic click failed:', error.message);
    }

    // Test 4: List session logs tool
    console.log('\n📝 Testing session logs listing...');
    
    const listResult = await client.callTool({
      name: 'browser_list_session_logs',
      arguments: { limit: 3 }
    });
    
    const listText = listResult.content[0].text;
    if (listText.includes('Available Session Logs')) {
      console.log('✅ Session logs tool working');
    }

    // Test 5: Manual interaction period
    console.log('\n👤 Manual interaction period starting...');
    console.log('   🖱️  Please interact with the browser (click, type, scroll)');
    console.log('   ⏰ Test will continue in 15 seconds for dual output generation...');
    
    await new Promise(resolve => setTimeout(resolve, 15000));

    // Test 6: End session and generate outputs
    console.log('\n🏁 Ending session and testing dual outputs...');
    
    const endResult = await client.callTool({
      name: 'browser_end_user_session',
      arguments: { 
        filename: 'dual-output-test',
        closeAfter: false
      }
    });

    const endText = endResult.content[0].text;
    
    // Verify dual output messaging
    if (endText.includes('Playwright trace.zip') && endText.includes('Session .md log')) {
      console.log('✅ Dual output messaging present');
    } else {
      console.log('⚠️  Missing dual output messaging');
    }

    // Test 7: Verify actual file outputs
    console.log('\n📁 Verifying output files...');
    
    let traceFile, sessionLogDir;
    
    // Extract trace file path from response
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

    // Test 8: Test trace viewer tool
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
    }

    // Test 9: Verify session log content
    console.log('\n📋 Testing enhanced session log format...');
    
    // Look for session directories
    const outputDir = path.dirname(traceFile || './output');
    const sessionDirs = fs.readdirSync(outputDir, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory() && dirent.name.startsWith('session-'))
      .sort((a, b) => b.name.localeCompare(a.name));
    
    if (sessionDirs.length > 0) {
      const latestSession = sessionDirs[0];
      const sessionLogPath = path.join(outputDir, latestSession.name, 'session.md');
      
      if (fs.existsSync(sessionLogPath)) {
        const sessionContent = fs.readFileSync(sessionLogPath, 'utf-8');
        
        const checks = [
          { name: 'Dual Recording System header', test: sessionContent.includes('📊 Dual Recording System') },
          { name: 'Human Interaction Timeline', test: sessionContent.includes('🎯 Human Interaction Timeline') },
          { name: 'Session metadata', test: sessionContent.includes('Session Started:') },
          { name: 'Enhanced formatting', test: sessionContent.includes('**Target Element:**') || sessionContent.includes('**Generated Code:**') }
        ];
        
        checks.forEach(check => {
          console.log(check.test ? '✅' : '❌', check.name);
        });
        
        const sessionStats = fs.statSync(sessionLogPath);
        console.log(`📄 Session log size: ${(sessionStats.size / 1024).toFixed(2)} KB`);
      } else {
        console.log('❌ Session log file not found');
      }
    } else {
      console.log('⚠️  No session directories found');
    }
  } catch (error) {
    console.error('❌ Test error:', error.message);
  } finally {
    await client.close();
    console.log('\n✅ Dual output system test completed!');
  }
}

testDualOutputSystem().catch(console.error);