#!/usr/bin/env node

/**
 * Standalone trace processor for testing ZIP modification logic
 * This copies the latest trace folder and experiments with modifications
 * until we get the trace viewer working correctly
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

async function main() {
  console.log('🔧 Trace Processor Test Tool');
  console.log('============================\n');

  // Find the latest trace directory
  const outputDir = path.join(process.cwd(), 'playwright-mcp-output');
  const traceDirs = fs.readdirSync(outputDir, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory() && dirent.name.match(/^\d{4}-\d{2}-\d{2}T/))
    .map(dirent => ({ name: dirent.name, path: path.join(outputDir, dirent.name) }))
    .sort((a, b) => b.name.localeCompare(a.name));

  if (traceDirs.length === 0) {
    console.error('❌ No trace directories found');
    process.exit(1);
  }

  const latestDir = traceDirs[0];
  const tracesPath = path.join(latestDir.path, 'traces');
  
  console.log('📂 Latest trace directory:', latestDir.name);
  console.log('📂 Traces path:', tracesPath);

  if (!fs.existsSync(tracesPath)) {
    console.error('❌ Traces directory not found:', tracesPath);
    process.exit(1);
  }

  // Create test directory
  const testDir = path.join(outputDir, 'trace-test-' + Date.now());
  fs.mkdirSync(testDir, { recursive: true });
  const testTracesDir = path.join(testDir, 'traces');
  
  console.log('📁 Created test directory:', testDir);
  
  // Copy traces folder
  await copyDirectory(tracesPath, testTracesDir);
  console.log('✅ Copied traces to test directory');

  // List available files
  const files = fs.readdirSync(testTracesDir);
  console.log('\n📋 Available files:');
  files.forEach(file => {
    const filePath = path.join(testTracesDir, file);
    const stats = fs.statSync(filePath);
    console.log(`  - ${file} (${(stats.size / 1024).toFixed(1)} KB)`);
  });

  // Find the ZIP file
  const zipFile = files.find(f => f.endsWith('.zip'));
  if (!zipFile) {
    console.error('❌ No ZIP file found');
    process.exit(1);
  }

  console.log(`\n🎯 Found ZIP file: ${zipFile}`);
  console.log(`📍 Test ZIP path: ${path.join(testTracesDir, zipFile)}`);

  // Now let's analyze and modify the ZIP
  await processTestZip(path.join(testTracesDir, zipFile));
}

async function copyDirectory(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  
  const entries = fs.readdirSync(src, { withFileTypes: true });
  
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    
    if (entry.isDirectory()) {
      await copyDirectory(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

async function processTestZip(zipPath) {
  console.log('\n🔧 Processing ZIP file...');
  console.log('📦 ZIP path:', zipPath);

  try {
    // Import ZIP libraries dynamically
    const yauzl = await import('yauzl');
    const yazl = await import('yazl');
    
    console.log('✅ ZIP libraries loaded');
    
    // Create temporary directory for extraction
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-test-'));
    console.log('📁 Temp directory:', tempDir);
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        console.error('❌ ZIP processing timeout');
        reject(new Error('Timeout'));
      }, 30000);
      
      yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
        if (err) {
          console.error('❌ Failed to open ZIP:', err);
          clearTimeout(timeout);
          reject(err);
          return;
        }
        
        console.log('✅ ZIP file opened');
        
        const extractedFiles = [];
        const allFiles = [];
        
        zipfile.readEntry();
        
        zipfile.on('entry', (entry) => {
          allFiles.push(entry.fileName);
          console.log(`📁 ZIP entry: ${entry.fileName}`);
          
          if (entry.fileName.endsWith('.trace')) {
            console.log(`🎯 Found trace file: ${entry.fileName}`);
            
            zipfile.openReadStream(entry, (err, readStream) => {
              if (err) {
                console.error('❌ Failed to read trace file:', err);
                return;
              }
              
              const chunks = [];
              readStream.on('data', (chunk) => chunks.push(chunk));
              readStream.on('end', () => {
                const content = Buffer.concat(chunks).toString('utf8');
                const lineCount = content.split('\n').filter(line => line.trim()).length;
                const hasHumanActions = content.includes('👤 Human');
                
                console.log(`📄 Trace file analysis:`);
                console.log(`   - File: ${entry.fileName}`);
                console.log(`   - Lines: ${lineCount}`);
                console.log(`   - Has human actions: ${hasHumanActions}`);
                console.log(`   - First 150 chars: ${content.substring(0, 150).replace(/\n/g, '\\n')}`);
                
                if (hasHumanActions) {
                  console.log('🎯 This trace has human actions - will process this one!');
                  
                  // Show the human actions and their context
                  const lines = content.split('\n');
                  const humanActionLines = lines.filter(line => line.includes('👤 Human'));
                  console.log(`\n👤 Found ${humanActionLines.length} human action entries:`);
                  humanActionLines.forEach((line, i) => {
                    try {
                      const event = JSON.parse(line);
                      console.log(`  ${i+1}. ${event.title} (callId: ${event.callId}, time: ${event.startTime})`);
                      
                      // Show nearby snapshots for debugging
                      const nearbySnapshot = findBestSnapshot(lines, event.startTime, pageId);
                      console.log(`      Best snapshot: ${nearbySnapshot}`);
                    } catch (e) {
                      console.log(`  ${i+1}. ${line.substring(0, 100)}...`);
                    }
                  });
                  
                  // Here we'll add our modification logic
                  const modifiedContent = modifyTraceContent(content);
                  
                  extractedFiles.push({
                    name: entry.fileName,
                    content: Buffer.from(modifiedContent, 'utf8')
                  });
                } else {
                  // Keep original
                  extractedFiles.push({
                    name: entry.fileName,
                    content: Buffer.concat(chunks)
                  });
                }
                
                zipfile.readEntry();
              });
            });
          } else {
            // Copy other files as-is
            zipfile.openReadStream(entry, (err, readStream) => {
              if (err) {
                console.error('❌ Failed to read file:', entry.fileName);
                return;
              }
              
              const chunks = [];
              readStream.on('data', (chunk) => chunks.push(chunk));
              readStream.on('end', () => {
                extractedFiles.push({
                  name: entry.fileName,
                  content: Buffer.concat(chunks)
                });
                zipfile.readEntry();
              });
            });
          }
        });
        
        zipfile.on('end', () => {
          console.log(`\n🏁 ZIP extraction complete - found ${allFiles.length} files`);
          
          // Create new ZIP with modifications
          const newZipPath = zipPath.replace('.zip', '-modified.zip');
          console.log('📦 Creating modified ZIP:', newZipPath);
          
          const zipFile = new yazl.ZipFile();
          
          for (const file of extractedFiles) {
            zipFile.addBuffer(file.content, file.name);
          }
          
          zipFile.outputStream.pipe(fs.createWriteStream(newZipPath))
            .on('close', () => {
              console.log('✅ Modified ZIP created successfully!');
              console.log(`📍 Test with: npx playwright show-trace "${newZipPath}"`);
              
              // Cleanup
              fs.rmSync(tempDir, { recursive: true, force: true });
              clearTimeout(timeout);
              resolve();
            })
            .on('error', (error) => {
              console.error('❌ Failed to create modified ZIP:', error);
              clearTimeout(timeout);
              reject(error);
            });
          
          zipFile.end();
        });
        
        zipfile.on('error', (error) => {
          console.error('❌ ZIP error:', error);
          clearTimeout(timeout);
          reject(error);
        });
      });
    });
    
  } catch (error) {
    console.error('❌ Process error:', error);
    throw error;
  }
}

function modifyTraceContent(content) {
  console.log('\n🔄 MODIFYING TRACE CONTENT');
  
  const lines = content.split('\n');
  const newLines = [];
  
  // Extract pageId from existing content  
  const pageIdMatch = content.match(/"pageId":"(page@[^"]+)"/);
  const pageId = pageIdMatch ? pageIdMatch[1] : '';
  console.log('🔍 Extracted pageId:', pageId || 'none found');
  
  if (!pageId) {
    console.log('⚠️ No pageId found in content - this may cause snapshot reference issues');
  }
  
  let modificationsCount = 0;
  
  for (const line of lines) {
    if (!line.trim()) {
      newLines.push(line);
      continue;
    }
    
    try {
      const event = JSON.parse(line);
      
      // Check if this is a human action trace group that needs replacement
      if (event.type === 'before' && 
          event.class === 'Tracing' && 
          event.method === 'tracingGroup' && 
          event.title && 
          event.title.startsWith('👤 Human')) {
        
        console.log(`🎯 REPLACING: ${event.title}`);
        
        // Extract action info from title
        const actionInfo = parseHumanActionTitle(event.title);
        
        if (actionInfo) {
          // Create proper Locator event
          const locatorEvent = {
            ...event,
            class: 'Locator',
            method: actionInfo.method,
            params: actionInfo.params,
            pageId: pageId,
            // Find a proper snapshot reference
            beforeSnapshot: findBestSnapshot(lines, event.startTime, pageId)
          };
          
          console.log(`✅ Replaced with Locator: ${actionInfo.method} on ${actionInfo.selector}`);
          newLines.push(JSON.stringify(locatorEvent));
          modificationsCount++;
        } else {
          console.log(`⚠️ Could not parse action info, keeping original`);
          newLines.push(line);
        }
      } else {
        // Keep original line
        newLines.push(line);
      }
    } catch (error) {
      // Keep malformed lines as-is
      newLines.push(line);
    }
  }
  
  console.log(`📝 Modifications complete: ${modificationsCount} replacements made`);
  return newLines.join('\n');
}

function parseHumanActionTitle(title) {
  // Parse titles like "👤 Human click [left] → internal:role=link[name="More information..."i] | https://example.com/ | 2025-09-04T02:19:03.326Z"
  try {
    const parts = title.split(' → ');
    if (parts.length < 2) return null;
    
    const actionPart = parts[0]; // "👤 Human click [left]"
    const selectorPart = parts[1].split(' | ')[0]; // "internal:role=link[name="More information..."i]"
    
    // Extract action type
    let method = 'click'; // default
    if (actionPart.includes('fill')) method = 'fill';
    else if (actionPart.includes('click')) method = 'click';
    else if (actionPart.includes('type')) method = 'type';
    
    // Extract button if present
    const buttonMatch = actionPart.match(/\[(\w+)\]/);
    const button = buttonMatch ? buttonMatch[1] : 'left';
    
    return {
      method,
      selector: selectorPart,
      params: {
        selector: selectorPart,
        button: method === 'click' ? button : undefined
      }
    };
  } catch (error) {
    console.error('❌ Error parsing action title:', error);
    return null;
  }
}

function findBestSnapshot(lines, targetTime, pageId) {
  console.log(`🔍 Finding best snapshot for time ${targetTime} on page ${pageId || 'any'}`);
  
  // Find the most recent browser action with a snapshot before this human action
  let bestSnapshot = null;
  let bestTime = -1;
  let bestEvent = null;
  
  for (const line of lines) {
    try {
      const event = JSON.parse(line);
      
      // Skip non-browser actions (like Tracing groups)
      if (!event.startTime || event.class === 'Tracing') continue;
      
      // Only consider events before our target time
      if (event.startTime > targetTime) continue;
      
      // If pageId specified, prefer events on same page, but don't require it
      const pageMatch = !pageId || !event.pageId || event.pageId === pageId;
      const timeScore = pageMatch ? event.startTime : event.startTime * 0.8; // slight penalty for wrong page
      
      // Look for afterSnapshot first (final state), then beforeSnapshot
      if (event.afterSnapshot && timeScore > bestTime) {
        bestTime = timeScore;
        bestSnapshot = event.afterSnapshot;
        bestEvent = event;
        console.log(`   Found afterSnapshot candidate: ${event.afterSnapshot} at time ${event.startTime} (${event.class}.${event.method})`);
      } else if (!bestSnapshot && event.beforeSnapshot && timeScore > bestTime) {
        bestTime = timeScore;
        bestSnapshot = event.beforeSnapshot;
        bestEvent = event;
        console.log(`   Found beforeSnapshot candidate: ${event.beforeSnapshot} at time ${event.startTime} (${event.class}.${event.method})`);
      }
    } catch (error) {
      // Skip malformed lines
      continue;
    }
  }
  
  if (bestSnapshot && bestEvent) {
    console.log(`✅ Selected snapshot: ${bestSnapshot} from ${bestEvent.class}.${bestEvent.method} at ${bestEvent.startTime}`);
  } else {
    console.log(`⚠️ No suitable snapshot found, using fallback`);
  }
  
  return bestSnapshot || `before@snapshot_${targetTime}`;
}

main().catch(console.error);