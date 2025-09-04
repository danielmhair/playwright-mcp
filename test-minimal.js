#!/usr/bin/env node

/**
 * Minimal test to check MCP protocol
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

async function testMinimal() {
  console.log('🧪 Testing Minimal MCP\n');

  const client = new Client({ name: 'minimal-test', version: '1.0.0' });
  
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['cli.js'], // No extra flags
    cwd: process.cwd(),
    stdio: ['pipe', 'pipe', 'inherit'],
  });

  try {
    console.log('🚀 Starting MCP server...');
    await client.connect(transport);
    console.log('✅ Connected to MCP server');

    // Try listing tools first
    console.log('\n📍 Listing tools...');
    const toolsResult = await client.request({
      method: 'tools/list'
    });

    console.log('✅ Tools listed successfully');
    console.log('✅ Minimal test completed - MCP protocol is working!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await client.close();
  }
}

testMinimal().catch(console.error);