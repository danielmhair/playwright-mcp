#!/usr/bin/env node

/**
 * Simple test to check if MCP server can start without hanging
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

async function testSimpleStart() {
  console.log('🧪 Testing Simple MCP Server Start\n');

  const client = new Client({ name: 'simple-test', version: '1.0.0' });
  
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['cli.js', '--save-session'], // Minimal flags to avoid user session complexity
    cwd: process.cwd(),
    stdio: ['pipe', 'pipe', 'inherit'],
  });

  try {
    console.log('🚀 Starting MCP server...');
    await client.connect(transport);
    console.log('✅ Connected to MCP server');

    // Try a simple navigation
    console.log('\n📍 Testing simple navigation...');
    const navResult = await client.request({
      method: 'tools/call',
      params: {
        name: 'browser_navigate',
        arguments: { url: 'https://example.com' }
      }
    });

    console.log('✅ Navigation successful');
    console.log('✅ Simple test completed - server is working!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await client.close();
  }
}

testSimpleStart().catch(console.error);