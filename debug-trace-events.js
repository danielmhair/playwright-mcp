#!/usr/bin/env node

/**
 * Debug script to test human action trace event generation
 * This will help us see if our Locator events are being created and written properly
 */

const { spawn } = require('child_process');
const path = require('path');

console.log('🔍 Debug: Testing human action trace events...\n');

// Enable debug logging for this test
process.env.DEBUG = 'pw:mcp:test';

async function runTest() {
  console.log('🚀 Starting MCP server with debug logging...');
  
  const serverProcess = spawn('node', ['cli.js'], {
    cwd: process.cwd(),
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, DEBUG: 'pw:mcp:test' }
  });

  let serverOutput = '';
  let serverErrors = '';

  serverProcess.stdout.on('data', (data) => {
    const output = data.toString();
    serverOutput += output;
    // Show any debug messages immediately
    if (output.includes('🎯') || output.includes('✅') || output.includes('⚠️') || output.includes('Failed')) {
      console.log('DEBUG:', output.trim());
    }
  });

  serverProcess.stderr.on('data', (data) => {
    const error = data.toString();
    serverErrors += error;
    // Show debug messages from stderr too
    if (error.includes('🎯') || error.includes('✅') || error.includes('⚠️') || error.includes('Failed')) {
      console.log('DEBUG ERROR:', error.trim());
    }
  });

  // Wait for server to be ready
  console.log('⏳ Waiting for server to start...');
  await new Promise(resolve => setTimeout(resolve, 3000));

  console.log('📋 Server output so far:');
  if (serverOutput) console.log('STDOUT:', serverOutput);
  if (serverErrors) console.log('STDERR:', serverErrors);

  // Kill the server
  serverProcess.kill();
  console.log('\n✅ Debug test completed');
}

runTest().catch(console.error);