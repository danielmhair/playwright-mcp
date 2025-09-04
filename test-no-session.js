#!/usr/bin/env node

/**
 * Test without session logging to check if that's the issue
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

async function testNoSession() {
  console.log('🧪 Testing MCP Without Session Logging\n');

  const client = new Client({ name: 'no-session-test', version: '1.0.0' });
  
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['cli.js'], // No --save-session flag
    cwd: process.cwd(),
    stdio: ['pipe', 'pipe', 'inherit'],
  });

  try {
    console.log('🚀 Starting MCP server...');
    await client.connect(transport);
    console.log('✅ Connected to MCP server');

    // Try navigation
    console.log('\n📍 Testing navigation...');
    const navResult = await client.request({
      method: 'tools/call',
      params: {
        name: 'browser_navigate',
        arguments: { url: 'https://example.com' }
      }
    });

    console.log('✅ Navigation successful!');
    console.log('✅ Test completed without session logging!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await client.close();
  }
}

testNoSession().catch(console.error);