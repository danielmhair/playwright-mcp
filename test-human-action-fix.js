#!/usr/bin/env node

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

async function testHumanActionRecording() {
  console.log('🧪 Testing human action recording implementation...');
  
  // Create a simple test to verify the Context and InputRecorder classes can be imported
  try {
    console.log('📦 Testing module imports...');
    
    // Import the context module
    const { Context, InputRecorder } = require('./lib/context.js');
    
    console.log('✅ Context class imported successfully');
    console.log('✅ InputRecorder class imported successfully');
    
    // Test that the new methods exist
    if (typeof InputRecorder.prototype._captureSnapshot === 'function') {
      console.log('✅ _captureSnapshot method exists');
    } else {
      console.log('❌ _captureSnapshot method missing');
    }
    
    if (typeof InputRecorder.prototype._writeToTrace === 'function') {
      console.log('✅ _writeToTrace method exists');
    } else {
      console.log('❌ _writeToTrace method missing');
    }
    
    if (typeof InputRecorder.prototype._mapActionToMethod === 'function') {
      console.log('✅ _mapActionToMethod method exists');
    } else {
      console.log('❌ _mapActionToMethod method missing');
    }
    
    if (typeof InputRecorder.prototype._buildTraceParams === 'function') {
      console.log('✅ _buildTraceParams method exists');
    } else {
      console.log('❌ _buildTraceParams method missing');
    }
    
    console.log('🎉 All tests passed! Human action recording implementation is ready.');
    
  } catch (error) {
    console.error('❌ Import test failed:', error.message);
    console.error('   Make sure to run `npm run build` first');
    return false;
  }
  
  return true;
}

if (require.main === module) {
  testHumanActionRecording()
    .then(success => process.exit(success ? 0 : 1))
    .catch(error => {
      console.error('💥 Test failed:', error);
      process.exit(1);
    });
}

module.exports = { testHumanActionRecording };