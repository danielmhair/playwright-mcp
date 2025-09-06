#!/usr/bin/env node

/**
 * Standalone post-processing test script
 * Repeatedly processes existing trace.zip files to test and debug
 * the "Bounding box" renaming functionality
 */

import fs from 'fs';
import path from 'path';

async function findLatestTraceFile() {
  const outputDir = 'playwright-mcp-output';
  if (!fs.existsSync(outputDir)) {
    console.log('❌ No playwright-mcp-output directory found');
    return null;
  }

  // Find all session directories
  const sessions = fs.readdirSync(outputDir)
    .filter(name => fs.statSync(path.join(outputDir, name)).isDirectory())
    .sort()
    .reverse(); // Get newest first

  for (const session of sessions) {
    const sessionDir = path.join(outputDir, session);
    const tracesDir = path.join(sessionDir, 'traces');
    
    if (fs.existsSync(tracesDir)) {
      const traceFiles = fs.readdirSync(tracesDir)
        .filter(name => name.endsWith('.zip'))
        .map(name => path.join(tracesDir, name));
      
      if (traceFiles.length > 0) {
        return traceFiles[0]; // Return first trace file found
      }
    }
  }
  
  return null;
}

async function duplicateTraceFile(originalPath) {
  const dir = path.dirname(originalPath);
  const basename = path.basename(originalPath, '.zip');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const newPath = path.join(dir, `${basename}-copy-${timestamp}.zip`);
  
  fs.copyFileSync(originalPath, newPath);
  console.log(`📁 Created copy: ${newPath}`);
  return newPath;
}

async function analyzeTraceFile(traceFilePath) {
  console.log(`🔍 Analyzing trace file: ${traceFilePath}`);
  
  try {
    const yauzl = await import('yauzl');
    
    const zipFile = await new Promise((resolve, reject) => {
      yauzl.open(traceFilePath, { lazyEntries: true }, (err, zipFile) => {
        if (err) reject(err);
        else resolve(zipFile);
      });
    });

    const entries = new Map();
    await new Promise((resolve, reject) => {
      zipFile.readEntry();
      zipFile.on('entry', (entry) => {
        if (/\/$/.test(entry.fileName)) {
          zipFile.readEntry();
          return;
        }
        
        zipFile.openReadStream(entry, (err, readStream) => {
          if (err) {reject(err);} else {
            const chunks = [];
            readStream.on('data', (chunk) => chunks.push(chunk));
            readStream.on('end', () => {
              entries.set(entry.fileName, Buffer.concat(chunks));
              zipFile.readEntry();
            });
          }
        });
      });
      zipFile.on('end', resolve);
      zipFile.on('error', reject);
    });

    // Look for trace.trace file first, then fallback to trace.trace
    let traceData = entries.get('trace.trace');
    let traceFileName = 'trace.trace';
    
    if (!traceData) {
      console.log('❌ No trace file found in ZIP (looked for trace.trace and trace.trace)');
      return null;
    }
    
    console.log(`📋 Using trace file: ${traceFileName}`);
    console.log(`📁 Available files in ZIP: ${Array.from(entries.keys()).join(', ')}`);

    const traceLines = traceData.toString().split('\n').filter(line => line.trim());
    const events = traceLines.map(line => JSON.parse(line));

    // Count different event types
    const eventCounts = {};
    const boundingBoxEvents = [];
    
    for (const event of events) {
      const key = `${event.type}:${event.class}:${event.method}`;
      eventCounts[key] = (eventCounts[key] || 0) + 1;
      
      // Look for events with title "Bounding box" (our human actions)
      if (event.type === 'before' && event.title === 'Bounding box') {
        boundingBoxEvents.push({
          selector: event.params?.selector,
          startTime: event.startTime,
          callId: event.callId,
          pageId: event.pageId,
          class: event.class,
          method: event.method,
          title: event.title
        });
      }
    }

    console.log('📊 Event Analysis:');
    Object.entries(eventCounts)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 10)
      .forEach(([type, count]) => {
        console.log(`   ${type}: ${count}`);
      });

    console.log(`\n🎯 Found ${boundingBoxEvents.length} "Bounding box" events:`);
    boundingBoxEvents.forEach((event, i) => {
      console.log(`   ${i + 1}. Title: ${event.title}, Class: ${event.class}, Method: ${event.method}`);
      console.log(`      Selector: ${event.selector || 'unknown'}`);
      console.log(`      Time: ${event.startTime}, CallID: ${event.callId}`);
    });

    return { events, boundingBoxEvents, entries, traceFileName };

  } catch (error) {
    console.log('❌ Analysis failed:', error);
    return null;
  }
}

function generateActionDescription(selector, actionType = 'click') {
  if (!selector) return `${actionType} element`;
  
  // Handle internal selectors (like internal:role=combobox[name="Search"])
  if (selector.includes('internal:role=')) {
    const roleMatch = selector.match(/internal:role=(\w+)(?:\[name="([^"]+)"\])?/);
    if (roleMatch) {
      const role = roleMatch[1];
      const name = roleMatch[2];
      if (name) {
        return `${actionType} on ${name} ${role}`;
      }
      return `${actionType} ${role}`;
    }
  }
  
  // Handle internal text selectors
  if (selector.includes('internal:text=')) {
    const textMatch = selector.match(/internal:text="([^"]+)"/);
    if (textMatch) {
      return `${actionType} "${textMatch[1]}" element`;
    }
  }
  
  // Handle regular CSS selectors
  if (selector.includes('input')) {
    if (selector.includes('[type="search"]')) return `${actionType === 'click' ? 'focus' : actionType} search field`;
    return `${actionType === 'click' ? 'focus' : actionType} input field`;
  }
  
  if (selector.includes('button')) return `${actionType} button`;
  if (selector.includes('a')) return `${actionType} link`;
  
  return `${actionType} element`;
}

async function postProcessTrace(traceFilePath, customActionName = 'Manual Action') {
  console.log(`\n🔧 Post-processing trace file with intelligent action naming`);
  
  const analysisResult = await analyzeTraceFile(traceFilePath);
  if (!analysisResult) return false;

  const { events, boundingBoxEvents, entries, traceFileName } = analysisResult;

  try {
    const yazl = await import('yazl');
    
    // Modify events - rename boundingBox to click
    let renamedCount = 0;
    const modifiedEvents = events.map(event => {
      // Look for events with title "Bounding box" (our human actions)
      if (event.type === 'before' && event.title === 'Bounding box') {
        renamedCount++;
        
        // Generate intelligent action description based on selector
        const actionDescription = generateActionDescription(event.params?.selector, 'click');
        
        console.log(`🎯 Renaming event #${renamedCount}: "${event.title}" → "${actionDescription}"`);
        console.log(`    Class: ${event.class}, Method: ${event.method}`);
        console.log(`    Selector: ${event.params?.selector}`);
        
        // Create a completely clean copy with only essential fields to avoid Zod recursion
        const getActionMethod = (actionName) => {
          const actionVerb = actionName.toLowerCase().split(' ')[0];
          const methodMap = {
            'click': 'click', 'type': 'fill', 'fill': 'fill', 
            'focus': 'focus', 'hover': 'hover', 'scroll': 'scroll',
            'press': 'press', 'select': 'selectOption'
          };
          return methodMap[actionVerb] || 'click';
        };
        
        const actionMethod = getActionMethod(actionDescription);
        
        const transformedEvent = {
          type: event.type,
          callId: event.callId,
          startTime: event.startTime,
          title: actionDescription, // Change to custom action name
          class: 'Locator', // Change to Locator for element highlighting  
          method: actionMethod, // Use actual action method based on action name
          pageId: event.pageId,
          beforeSnapshot: event.beforeSnapshot,
          humanAction: true, // Add marker to identify our custom entries
          customActionName: actionDescription, // Store the custom name for reference
          params: event.params ? {
            selector: event.params.selector,
            strict: event.params.strict,
            timeout: event.params.timeout,
            state: event.params.state
          } : {},
        };
        
        // Add locator field if selector exists for proper trace viewer display
        if (event.params?.selector) {
          transformedEvent.locator = event.params.selector;
        }
        
        return transformedEvent;
      }
      return event;
    });

    // Create new ZIP
    const newZipFile = new yazl.ZipFile();
    
    // Add all original entries except the trace file we're modifying
    for (const [fileName, content] of entries) {
      if (fileName !== traceFileName) {
        newZipFile.addBuffer(content, fileName);
      }
    }
    
    // Add modified trace file
    const modifiedTraceContent = modifiedEvents.map(event => JSON.stringify(event)).join('\n');
    newZipFile.addBuffer(Buffer.from(modifiedTraceContent), traceFileName);
    
    // Write to temporary file first
    const tempPath = traceFilePath + '.tmp';
    newZipFile.outputStream.pipe(fs.createWriteStream(tempPath));
    newZipFile.end();
    
    await new Promise((resolve, reject) => {
      newZipFile.outputStream.on('close', resolve);
      newZipFile.outputStream.on('error', reject);
    });
    
    // Replace original with modified version
    fs.renameSync(tempPath, traceFilePath);
    
    console.log(`✅ Successfully renamed ${renamedCount} "boundingBox" entries to "${customActionName}"`);
    return true;
    
  } catch (error) {
    console.log('❌ Post-processing failed:', error);
    return false;
  }
}

async function main() {
  console.log('🔄 Standalone Post-Processing Test Tool\n');

  // Use specific recorded session file for testing
  const latestTrace = 'playwright-mcp-output/2025-09-05T14-15-21.549Z/traces/recorded-session-1757081738872.zip';
  if (!fs.existsSync(latestTrace)) {
    console.log('❌ Test trace file not found. Looking for any trace files...');
    const fallbackTrace = await findLatestTraceFile();
    if (!fallbackTrace) {
      console.log('❌ No trace files found. Run a browser recording session first.');
      return;
    }
    console.log(`📋 Using fallback trace: ${fallbackTrace}`);
  }

  console.log(`📋 Found trace file: ${latestTrace}`);

  // Create a copy to work with
  const workingCopy = await duplicateTraceFile(latestTrace);

  // Analyze original
  console.log('\n📊 BEFORE POST-PROCESSING:');
  await analyzeTraceFile(workingCopy);

  // Post-process
  const success = await postProcessTrace(workingCopy, 'User Interaction');

  if (success) {
    // Analyze result
    console.log('\n📊 AFTER POST-PROCESSING:');
    await analyzeTraceFile(workingCopy);

    console.log(`\n🎭 Test the processed trace file:`);
    console.log(`npx playwright show-trace "${workingCopy}"`);
  }
}

main().catch(console.error);