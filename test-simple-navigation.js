#!/usr/bin/env node

/**
 * Simple test for navigation only
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

async function testSimpleNavigation() {
  console.log('🧪 Testing Simple Navigation\n');

  const client = new Client({ name: 'simple-nav-test', version: '1.0.0' });
  
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['cli.js'], // No flags at all
    cwd: process.cwd(),
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, NODE_ENV: 'mcp' }
  });

  try {
    console.log('🚀 Connecting to MCP server...');
    await client.connect(transport);
    console.log('✅ Connected successfully');

    console.log('\n📍 Testing navigation with very long timeout...');
    
    // Set a long timeout for this test
    const navResult = await Promise.race([
      client.request({
        method: 'tools/call',
        params: {
          name: 'browser_navigate',
          arguments: { url: 'https://example.com' }
        }
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Navigation timeout after 90 seconds')), 90000))
    ]);

    console.log('✅ Navigation completed successfully!');
    console.log('Response preview:', navResult.content?.[0]?.text?.substring(0, 200) + '...');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    if (error.message.includes('parse')) {
      console.error('This appears to be a JSON parsing issue - likely stdout contamination');
    } else if (error.message.includes('timeout')) {
      console.error('Navigation is hanging - likely browser context creation issue');
    }
  } finally {
    try {
      await client.close();
    } catch (e) {
      // Ignore close errors
    }
  }
}

testSimpleNavigation().catch(console.error);