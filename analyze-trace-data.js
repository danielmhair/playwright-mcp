#!/usr/bin/env node

/**
 * Trace Data Analysis Tool
 * Analyzes temporal relationships between actions, HTML snapshots, screenshots, and network events
 * Perfect for vector space processing and understanding what data is available when
 */

import fs from 'fs';
import path from 'path';

async function main() {
  console.log('🔍 Trace Data Analysis Tool');
  console.log('==========================\n');

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

  // Find the user session trace file
  const files = fs.readdirSync(tracesPath);
  const userTraceFile = files.find(f => f.includes('user-session-trace.trace'));
  
  if (!userTraceFile) {
    console.error('❌ No user session trace file found');
    process.exit(1);
  }

  console.log(`🎯 Analyzing trace file: ${userTraceFile}\n`);
  
  await analyzeTraceData(path.join(tracesPath, userTraceFile));
}

async function analyzeTraceData(traceFilePath) {
  const content = fs.readFileSync(traceFilePath, 'utf8');
  const lines = content.split('\n').filter(line => line.trim());
  
  console.log(`📄 Total trace entries: ${lines.length}\n`);
  
  // Also check for ZIP file in same directory
  const tracesDir = path.dirname(traceFilePath);
  const zipFiles = fs.readdirSync(tracesDir).filter(f => f.endsWith('.zip'));
  console.log(`📦 ZIP files available: ${zipFiles.join(', ')}\n`);
  
  // Analyze ZIP contents to map URLs to actual file paths
  const resourceMap = new Map(); // URL -> actual file path in ZIP
  if (zipFiles.length > 0) {
    await analyzeZipContents(path.join(tracesDir, zipFiles[0]), resourceMap);
  }
  
  // Data structures to organize temporal data
  const timeline = [];
  const htmlSnapshots = new Map(); // callId -> HTML content
  const screenshots = new Map(); // timestamp -> screenshot info
  const humanActions = [];
  const networkEvents = [];
  const pageNavigations = [];
  const resourceFiles = new Map(); // URL -> resource info
  
  // Parse all events and organize by type
  for (const [index, line] of lines.entries()) {
    try {
      const event = JSON.parse(line);
      
      // Add to timeline with original line number for reference
      timeline.push({ ...event, lineNumber: index + 1 });
      
      // Categorize events
      switch (event.type) {
        case 'frame-snapshot':
          const htmlInfo = analyzeHtmlContent(event.snapshot.html, event.snapshot.frameUrl);
          htmlSnapshots.set(event.snapshot.callId, {
            callId: event.snapshot.callId,
            snapshotName: event.snapshot.snapshotName,
            pageId: event.snapshot.pageId,
            frameUrl: event.snapshot.frameUrl,
            html: event.snapshot.html,
            timestamp: event.snapshot.timestamp,
            wallTime: event.snapshot.wallTime,
            viewport: event.snapshot.viewport,
            // Enhanced analysis
            title: htmlInfo.title,
            cssFiles: htmlInfo.cssFiles,
            jsFiles: htmlInfo.jsFiles,
            images: htmlInfo.images,
            links: htmlInfo.links,
            inlineStyles: htmlInfo.inlineStyles,
            textContent: htmlInfo.textContent,
            // Resource mapping
            resourceMap: resourceMap
          });
          break;
          
        case 'screencast-frame':
          screenshots.set(event.timestamp, {
            pageId: event.pageId,
            sha1: event.sha1,
            timestamp: event.timestamp,
            wallTime: event.frameSwapWallTime,
            width: event.width,
            height: event.height
          });
          break;
          
        case 'before':
          if (event.title && event.title.startsWith('👤 Human')) {
            humanActions.push({
              callId: event.callId,
              startTime: event.startTime,
              title: event.title,
              pageId: event.pageId,
              lineNumber: index + 1
            });
          } else if (event.class === 'Frame' && event.method === 'goto') {
            pageNavigations.push({
              callId: event.callId,
              startTime: event.startTime,
              url: event.params.url,
              pageId: event.pageId,
              beforeSnapshot: event.beforeSnapshot
            });
          }
          break;
          
        case 'console':
          if (event.messageType === 'error' && event.location?.url) {
            // Extract resource information from console errors
            const resourceInfo = analyzeNetworkError(event.text, event.location.url);
            networkEvents.push({
              time: event.time,
              pageId: event.pageId,
              message: event.text,
              url: event.location.url,
              resourceType: resourceInfo.type,
              statusCode: resourceInfo.statusCode,
              errorType: resourceInfo.errorType
            });
            
            // Add to resource files map
            if (!resourceFiles.has(event.location.url)) {
              resourceFiles.set(event.location.url, {
                url: event.location.url,
                type: resourceInfo.type,
                status: 'failed',
                error: event.text,
                firstSeen: event.time
              });
            }
          } else if (event.messageType === 'log' || event.messageType === 'info') {
            // Look for successful resource loads in logs
            const resourceInfo = extractResourceFromLog(event.text);
            if (resourceInfo) {
              networkEvents.push({
                time: event.time,
                pageId: event.pageId,
                message: event.text,
                url: resourceInfo.url,
                resourceType: resourceInfo.type,
                statusCode: 200,
                errorType: null
              });
            }
          }
          break;
      }
    } catch (error) {
      console.warn(`⚠️ Failed to parse line ${index + 1}: ${error.message}`);
    }
  }
  
  console.log('📊 DATA SUMMARY');
  console.log('================');
  console.log(`HTML Snapshots: ${htmlSnapshots.size}`);
  console.log(`Screenshots: ${screenshots.size}`);
  console.log(`Human Actions: ${humanActions.length}`);
  console.log(`Network Events: ${networkEvents.length}`);
  console.log(`Page Navigations: ${pageNavigations.length}\n`);
  
  // Analyze temporal relationships
  console.log('⏱️  TEMPORAL ANALYSIS');
  console.log('====================');
  
  humanActions.forEach((action, index) => {
    console.log(`\n👤 Human Action ${index + 1}: ${action.title}`);
    console.log(`   Time: ${action.startTime}ms`);
    console.log(`   Page: ${action.pageId}`);
    
    // Find closest HTML snapshot
    const targetUrl = extractUrlFromTitle(action.title);
    const closestSnapshot = findClosestSnapshot(htmlSnapshots, action.startTime, targetUrl);
    if (closestSnapshot) {
      console.log(`   📄 Closest HTML: ${closestSnapshot.snapshotName} (${closestSnapshot.frameUrl})`);
      console.log(`       HTML timestamp: ${closestSnapshot.timestamp}ms (${Math.abs(action.startTime - closestSnapshot.timestamp)}ms away)`);
      console.log(`       Page title: "${closestSnapshot.title}"`);
      
      if (closestSnapshot.cssFiles.length > 0) {
        console.log(`       🎨 CSS Files (${closestSnapshot.cssFiles.length}):`);
        closestSnapshot.cssFiles.forEach(css => console.log(`           ${css}`));
      }
      
      if (closestSnapshot.jsFiles.length > 0) {
        console.log(`       📜 JavaScript Files (${closestSnapshot.jsFiles.length}):`);
        closestSnapshot.jsFiles.forEach(js => console.log(`           ${js}`));
      }
      
      if (closestSnapshot.images.length > 0) {
        console.log(`       🖼️ Images (${closestSnapshot.images.length}):`);
        closestSnapshot.images.slice(0, 5).forEach(img => console.log(`           ${img}`));
        if (closestSnapshot.images.length > 5) {
          console.log(`           ... and ${closestSnapshot.images.length - 5} more`);
        }
      }
      
      if (closestSnapshot.inlineStyles.length > 0) {
        console.log(`       🎨 Inline Styles: ${closestSnapshot.inlineStyles.length} blocks`);
      }
    }
    
    // Find closest screenshot
    const closestScreenshot = findClosestScreenshot(screenshots, action.startTime);
    if (closestScreenshot) {
      console.log(`   📸 Closest Screenshot: ${closestScreenshot.sha1}`);
      console.log(`       Screenshot timestamp: ${closestScreenshot.timestamp}ms (${Math.abs(action.startTime - closestScreenshot.timestamp)}ms away)`);
    }
    
    // Find related network events after the action (next 10 seconds)
    const relatedNetworkEvents = networkEvents.filter(ne => 
      ne.time >= action.startTime && ne.time <= action.startTime + 10000
    );
    if (relatedNetworkEvents.length > 0) {
      console.log(`   🌐 Network Requests triggered (next 10s):`);
      relatedNetworkEvents.forEach(ne => {
        const timeDiff = ne.time - action.startTime;
        const status = ne.statusCode || 'unknown';
        const type = ne.resourceType || 'unknown';
        console.log(`       [+${timeDiff}ms] ${type} ${status}: ${ne.url}`);
        if (ne.errorType) {
          console.log(`           Error: ${ne.errorType}`);
        }
      });
    }
  });
  
  // Analyze what data we have for vector space processing
  console.log('\n🧠 VECTOR SPACE ANALYSIS');
  console.log('========================');
  
  console.log('\n✅ AVAILABLE DATA FOR EACH HUMAN ACTION:');
  humanActions.forEach((action, index) => {
    console.log(`\nAction ${index + 1}: ${extractActionFromTitle(action.title)}`);
    console.log(`  📍 Element: ${extractSelectorFromTitle(action.title)}`);
    console.log(`  🌍 URL: ${extractUrlFromTitle(action.title)}`);
    console.log(`  ⏰ Precise timestamp: ${action.startTime}ms`);
    
    const targetUrl = extractUrlFromTitle(action.title);
    const closestSnapshot = findClosestSnapshot(htmlSnapshots, action.startTime, targetUrl);
    if (closestSnapshot) {
      console.log(`  📄 HTML state available: ${closestSnapshot.frameUrl}`);
      console.log(`     - Page title: "${closestSnapshot.title}"`);
      
      if (closestSnapshot.cssFiles.length > 0) {
        console.log(`     - CSS files (${closestSnapshot.cssFiles.length}):`);
        closestSnapshot.cssFiles.forEach(css => {
          const filePath = closestSnapshot.resourceMap.get(css);
          console.log(`       ${css}`);
          if (filePath) {
            console.log(`         → ${filePath}`);
          }
        });
      }
      
      if (closestSnapshot.jsFiles.length > 0) {
        console.log(`     - JS files (${closestSnapshot.jsFiles.length}):`);
        closestSnapshot.jsFiles.forEach(js => {
          const filePath = closestSnapshot.resourceMap.get(js);
          console.log(`       ${js}`);
          if (filePath) {
            console.log(`         → ${filePath}`);
          }
        });
      }
      
      if (closestSnapshot.images.length > 0) {
        console.log(`     - Images (${closestSnapshot.images.length}):`);
        closestSnapshot.images.slice(0, 3).forEach(img => {
          const filePath = closestSnapshot.resourceMap.get(img);
          console.log(`       ${img}`);
          if (filePath) {
            console.log(`         → ${filePath}`);
          }
        });
        if (closestSnapshot.images.length > 3) {
          console.log(`       ... and ${closestSnapshot.images.length - 3} more images`);
        }
      }
      
      console.log(`     - ${closestSnapshot.links.length} links, ${closestSnapshot.inlineStyles.length} inline styles`);
      console.log(`     - Viewport: ${closestSnapshot.viewport.width}x${closestSnapshot.viewport.height}`);
    }
    
    const closestScreenshot = findClosestScreenshot(screenshots, action.startTime);
    if (closestScreenshot) {
      console.log(`  📸 Visual state available: ${closestScreenshot.sha1}`);
      console.log(`     - Resolution: ${closestScreenshot.width}x${closestScreenshot.height}`);
    }
    
    const networkRequests = networkEvents.filter(ne => 
      ne.time >= action.startTime && ne.time <= action.startTime + 10000
    );
    if (networkRequests.length > 0) {
      console.log(`  🌐 Network activity: ${networkRequests.length} requests in following 10s`);
    }
    
    console.log(`  📊 Vector embeddings possible from:`);
    console.log(`     - Action semantics: "${extractActionFromTitle(action.title)}" + selector`);
    console.log(`     - HTML structural: DOM tree, text content, element hierarchy`);
    console.log(`     - Visual context: Screenshot at ${Math.abs(action.startTime - (closestScreenshot?.timestamp || 0))}ms precision`);
    console.log(`     - Resource context: ${closestSnapshot?.cssFiles.length || 0} CSS + ${closestSnapshot?.jsFiles.length || 0} JS files`);
    console.log(`     - Network context: ${networkRequests.length} subsequent requests`);
    console.log(`     - Temporal context: Exact timing relationships`);
  });
  
  console.log('\n🔗 TEMPORAL CORRELATION QUALITY:');
  let perfectMatches = 0;
  let goodMatches = 0;
  let fairMatches = 0;
  
  humanActions.forEach(action => {
    const snapDiff = Math.abs(action.startTime - findClosestSnapshot(htmlSnapshots, action.startTime)?.timestamp);
    const screenDiff = Math.abs(action.startTime - findClosestScreenshot(screenshots, action.startTime)?.timestamp);
    
    if (snapDiff < 100 && screenDiff < 100) perfectMatches++;
    else if (snapDiff < 500 && screenDiff < 500) goodMatches++;
    else fairMatches++;
  });
  
  console.log(`✅ Perfect correlation (<100ms): ${perfectMatches}/${humanActions.length}`);
  console.log(`🟡 Good correlation (<500ms): ${goodMatches}/${humanActions.length}`);
  console.log(`⚠️ Fair correlation (>500ms): ${fairMatches}/${humanActions.length}`);
}

function findClosestSnapshot(htmlSnapshots, targetTime, targetUrl = null) {
  let closest = null;
  let closestDiff = Infinity;
  let exactMatch = null;
  
  console.log(`  🔍 Debug: Looking for snapshot near ${targetTime}ms, target URL: ${targetUrl}`);
  
  for (const snapshot of htmlSnapshots.values()) {
    const timeDiff = Math.abs(snapshot.timestamp - targetTime);
    
    console.log(`    📄 Snapshot: ${snapshot.frameUrl} at ${snapshot.timestamp}ms (${timeDiff}ms away)`);
    
    // If we have a target URL, prefer snapshots from the same domain
    if (targetUrl && snapshot.frameUrl) {
      try {
        const targetDomain = new URL(targetUrl).hostname;
        const snapshotDomain = new URL(snapshot.frameUrl).hostname;
        
        if (targetDomain === snapshotDomain && timeDiff < 10000) { // within 10 seconds and same domain
          if (!exactMatch || timeDiff < Math.abs(exactMatch.timestamp - targetTime)) {
            exactMatch = snapshot;
            console.log(`      ✅ Domain match found: ${snapshotDomain}`);
          }
        }
      } catch (e) {
        // URL parsing failed, continue with time-based matching
      }
    }
    
    // Fallback to closest by time
    if (timeDiff < closestDiff) {
      closestDiff = timeDiff;
      closest = snapshot;
    }
  }
  
  const result = exactMatch || closest;
  if (result) {
    console.log(`  ✅ Selected: ${result.frameUrl} at ${result.timestamp}ms`);
  } else {
    console.log(`  ❌ No suitable snapshot found`);
  }
  
  return result;
}

function findClosestScreenshot(screenshots, targetTime) {
  let closest = null;
  let closestDiff = Infinity;
  
  for (const screenshot of screenshots.values()) {
    const diff = Math.abs(screenshot.timestamp - targetTime);
    if (diff < closestDiff) {
      closestDiff = diff;
      closest = screenshot;
    }
  }
  
  return closest;
}

function extractActionFromTitle(title) {
  // Extract action from "👤 Human click [left] → ..."
  const actionMatch = title.match(/👤 Human (\w+)/);
  return actionMatch ? actionMatch[1] : 'unknown';
}

function extractSelectorFromTitle(title) {
  // Extract selector from "... → internal:text="..." | ..."
  const parts = title.split(' → ');
  if (parts.length > 1) {
    return parts[1].split(' | ')[0];
  }
  return 'unknown';
}

function extractUrlFromTitle(title) {
  // Extract URL from "... | https://... | timestamp"
  const parts = title.split(' | ');
  if (parts.length > 1) {
    return parts[1];
  }
  return 'unknown';
}

function analyzeHtmlContent(htmlArray, baseUrl) {
  // Parse Playwright's HTML array format to extract resources
  const result = {
    title: '',
    cssFiles: [],
    jsFiles: [],
    images: [],
    links: [],
    inlineStyles: [],
    textContent: ''
  };
  
  function parseElement(element) {
    if (typeof element === 'string') {
      result.textContent += element + ' ';
      return;
    }
    
    if (Array.isArray(element) && element.length >= 2) {
      const [tagName, attributes = {}, ...children] = element;
      
      // Extract resources based on tag type
      switch (tagName.toLowerCase()) {
        case 'title':
          if (children.length > 0 && typeof children[0] === 'string') {
            result.title = children[0];
          }
          break;
          
        case 'link':
          if (attributes.rel === 'stylesheet' && attributes.href) {
            result.cssFiles.push(resolveUrl(attributes.href, baseUrl));
          } else if (attributes.href) {
            result.links.push(resolveUrl(attributes.href, baseUrl));
          }
          break;
          
        case 'script':
          if (attributes.src) {
            result.jsFiles.push(resolveUrl(attributes.src, baseUrl));
          }
          break;
          
        case 'img':
          if (attributes.src || attributes.__playwright_current_src__) {
            const src = attributes.__playwright_current_src__ || attributes.src;
            result.images.push(resolveUrl(src, baseUrl));
          }
          break;
          
        case 'style':
          if (children.length > 0) {
            result.inlineStyles.push(children.join(''));
          }
          break;
          
        case 'a':
          if (attributes.href) {
            result.links.push(resolveUrl(attributes.href, baseUrl));
          }
          break;
      }
      
      // Recursively parse children
      children.forEach(child => parseElement(child));
    }
  }
  
  parseElement(htmlArray);
  
  // Remove duplicates
  result.cssFiles = [...new Set(result.cssFiles)];
  result.jsFiles = [...new Set(result.jsFiles)];
  result.images = [...new Set(result.images)];
  result.links = [...new Set(result.links)];
  
  return result;
}

function resolveUrl(url, baseUrl) {
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  if (url.startsWith('//')) return 'https:' + url;
  
  try {
    return new URL(url, baseUrl).href;
  } catch {
    return url;
  }
}

function analyzeNetworkError(errorMessage, url) {
  const result = {
    type: 'unknown',
    statusCode: null,
    errorType: null
  };
  
  // Determine resource type from URL
  if (url.includes('.css') || errorMessage.includes('stylesheet')) {
    result.type = 'css';
  } else if (url.includes('.js') || errorMessage.includes('script')) {
    result.type = 'javascript';
  } else if (url.match(/\.(png|jpg|jpeg|gif|svg|webp)/i)) {
    result.type = 'image';
  } else if (url.includes('.ttf') || url.includes('.woff') || errorMessage.includes('font')) {
    result.type = 'font';
  } else if (url.includes('favicon')) {
    result.type = 'icon';
  } else {
    result.type = 'document';
  }
  
  // Extract status code
  const statusMatch = errorMessage.match(/(\d{3})/);
  if (statusMatch) {
    result.statusCode = parseInt(statusMatch[1]);
  }
  
  // Determine error type
  if (errorMessage.includes('CORS policy')) {
    result.errorType = 'CORS';
  } else if (errorMessage.includes('ERR_FAILED')) {
    result.errorType = 'Network failure';
  } else if (errorMessage.includes('404')) {
    result.errorType = 'Not found';
  } else {
    result.errorType = 'Unknown error';
  }
  
  return result;
}

function extractResourceFromLog(logMessage) {
  // Try to extract resource information from log messages
  const urlMatch = logMessage.match(/https?:\/\/[^\s"']+/);
  if (urlMatch) {
    const url = urlMatch[0];
    return {
      url: url,
      type: url.includes('.css') ? 'css' : 
            url.includes('.js') ? 'javascript' :
            url.match(/\.(png|jpg|jpeg|gif|svg|webp)/i) ? 'image' :
            'document'
    };
  }
  return null;
}

async function analyzeZipContents(zipPath, resourceMap) {
  console.log(`🔍 Analyzing ZIP contents: ${path.basename(zipPath)}`);
  
  try {
    // Import ZIP library dynamically
    const yauzl = await import('yauzl');
    
    return new Promise((resolve, reject) => {
      yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
        if (err) {
          console.warn(`⚠️ Could not open ZIP file: ${err.message}`);
          resolve();
          return;
        }
        
        const zipEntries = [];
        
        zipfile.readEntry();
        
        zipfile.on('entry', (entry) => {
          zipEntries.push(entry.fileName);
          
          // Map common resource patterns to their ZIP paths
          const fileName = entry.fileName;
          
          // Try to infer URL from file path
          if (fileName.includes('resources/')) {
            const resourcePart = fileName.split('resources/')[1];
            // Common patterns: domain/path/file.ext
            const parts = resourcePart.split('/');
            if (parts.length >= 2) {
              const domain = parts[0];
              const filePath = parts.slice(1).join('/');
              const possibleUrl = `https://${domain}/${filePath}`;
              resourceMap.set(possibleUrl, fileName);
            }
          }
          
          // Also try HTTP variant
          if (fileName.includes('resources/')) {
            const resourcePart = fileName.split('resources/')[1];
            const parts = resourcePart.split('/');
            if (parts.length >= 2) {
              const domain = parts[0];
              const filePath = parts.slice(1).join('/');
              const possibleUrl = `http://${domain}/${filePath}`;
              resourceMap.set(possibleUrl, fileName);
            }
          }
          
          zipfile.readEntry();
        });
        
        zipfile.on('end', () => {
          console.log(`📁 Found ${zipEntries.length} entries in ZIP`);
          
          // Show some examples of what we found
          const resourceFiles = zipEntries.filter(f => f.includes('resources/'));
          if (resourceFiles.length > 0) {
            console.log(`🎯 Resource files found: ${resourceFiles.length}`);
            resourceFiles.slice(0, 5).forEach(f => console.log(`   ${f}`));
            if (resourceFiles.length > 5) {
              console.log(`   ... and ${resourceFiles.length - 5} more`);
            }
          }
          
          console.log(`📊 URL mappings created: ${resourceMap.size}\n`);
          resolve();
        });
        
        zipfile.on('error', (error) => {
          console.warn(`⚠️ ZIP error: ${error.message}`);
          resolve();
        });
      });
    });
    
  } catch (error) {
    console.warn(`⚠️ Error analyzing ZIP: ${error.message}`);
  }
}

main().catch(console.error);