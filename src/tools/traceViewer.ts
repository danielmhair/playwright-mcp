/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 * 
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { z } from 'zod';
import { defineTool } from './tool.js';

export const browserOpenTraceViewer = defineTool({
  capability: 'core',
  schema: {
    name: 'browser_open_trace_viewer',
    title: 'Open Playwright trace viewer',
    description: 'Opens the Playwright trace viewer for a specific trace file or lists available traces to view.',
    inputSchema: z.object({
      traceFile: z.string().optional().describe('Path to the trace file (.zip). If not provided, lists available traces.'),
      port: z.number().default(9323).describe('Port to run the trace viewer on'),
      openBrowser: z.boolean().default(true).describe('Whether to automatically open the browser'),
    }),
    type: 'readOnly',
  },
  handle: async (context, params, response) => {
    const { traceFile, port, openBrowser } = params;
    
    if (!traceFile) {
      // List available trace files
      await listAvailableTraces(context, response);
      return;
    }
    
    // Validate trace file exists
    if (!fs.existsSync(traceFile)) {
      response.addError(`Trace file not found: ${traceFile}`);
      return;
    }
    
    try {
      // Start the Playwright trace viewer
      const traceViewer = spawn('npx', ['playwright', 'show-trace', traceFile, '--port', port.toString()], {
        stdio: 'pipe',
        detached: true
      });
      
      let output = '';
      let errorOutput = '';
      
      traceViewer.stdout?.on('data', (data) => {
        output += data.toString();
      });
      
      traceViewer.stderr?.on('data', (data) => {
        errorOutput += data.toString();
      });
      
      // Wait a moment for the server to start
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      if (traceViewer.exitCode === null || traceViewer.exitCode === 0) {
        const viewerUrl = `http://localhost:${port}`;
        
        response.addResult('🎭 Playwright Trace Viewer Started');
        response.addResult('');
        response.addResult(`📁 Trace File: ${traceFile}`);
        response.addResult(`🌐 Viewer URL: ${viewerUrl}`);
        response.addResult(`🚪 Port: ${port}`);
        response.addResult('');
        response.addResult('🎯 What you can do in the trace viewer:');
        response.addResult('   • 📸 View screenshots at each step');
        response.addResult('   • 🌐 Inspect network requests and responses');
        response.addResult('   • 🔍 Examine page snapshots and DOM states');
        response.addResult('   • ⏱️ See timing information for all actions');
        response.addResult('   • 📊 Analyze performance metrics');
        response.addResult('');
        response.addResult('💡 Tips:');
        response.addResult('   • Use the timeline to navigate through actions');
        response.addResult('   • Click on network requests to see details');
        response.addResult('   • Hover over elements to see selectors');
        response.addResult('   • Use the search to find specific actions');
        
        if (openBrowser) {
          response.addResult('');
          response.addResult('🚀 Browser should automatically open to the trace viewer');
        }
        
        // Detach the process so it continues running
        traceViewer.unref();
        
      } else {
        response.addError(`Failed to start trace viewer. Exit code: ${traceViewer.exitCode}`);
        if (errorOutput) {
          response.addError(`Error output: ${errorOutput}`);
        }
      }
      
    } catch (error) {
      response.addError(`Failed to start trace viewer: ${error}`);
    }
  },
});

async function listAvailableTraces(context: any, response: any) {
  response.addResult('📁 Available Trace Files');
  response.addResult('');
  
  // Check for traces in the configured traces directory
  const tracesDir = context.config.browser.launchOptions.tracesDir;
  if (tracesDir && fs.existsSync(tracesDir)) {
    const traceFiles = fs.readdirSync(tracesDir)
      .filter(file => file.endsWith('.zip'))
      .map(file => {
        const filePath = path.join(tracesDir, file);
        const stats = fs.statSync(filePath);
        return {
          name: file,
          path: filePath,
          size: (stats.size / 1024 / 1024).toFixed(2) + ' MB',
          created: stats.ctime.toLocaleString()
        };
      })
      .sort((a, b) => fs.statSync(b.path).ctime.getTime() - fs.statSync(a.path).ctime.getTime());
    
    if (traceFiles.length > 0) {
      response.addResult(`Found ${traceFiles.length} trace file(s) in: ${tracesDir}`);
      response.addResult('');
      
      traceFiles.forEach((trace, index) => {
        response.addResult(`${index + 1}. **${trace.name}**`);
        response.addResult(`   📄 Size: ${trace.size}`);
        response.addResult(`   📅 Created: ${trace.created}`);
        response.addResult(`   📂 Path: ${trace.path}`);
        response.addResult('');
      });
      
      response.addResult('💡 To view a specific trace, use:');
      response.addResult('   `browser_open_trace_viewer` with traceFile parameter');
      response.addResult('');
      response.addResult('📋 Example:');
      response.addResult('   ```json');
      response.addResult('   {');
      response.addResult(`     "traceFile": "${traceFiles[0].path}"`);
      response.addResult('   }');
      response.addResult('   ```');
      
    } else {
      response.addResult('No trace files found in the traces directory.');
      response.addResult(`Traces directory: ${tracesDir}`);
    }
  } else {
    response.addResult('❌ No traces directory configured or directory does not exist.');
    response.addResult('');
    response.addResult('💡 To generate traces:');
    response.addResult('   1. Start MCP server with --save-trace-with-user-actions flag');
    response.addResult('   2. Use browser_start_user_session tool');
    response.addResult('   3. Perform manual interactions');
    response.addResult('   4. Use browser_end_user_session tool');
  }
}

export const browserListSessionLogs = defineTool({
  capability: 'core',
  schema: {
    name: 'browser_list_session_logs',
    title: 'List session logs',
    description: 'Lists all available session logs with detailed human interaction timelines.',
    inputSchema: z.object({
      limit: z.number().default(10).describe('Maximum number of sessions to list'),
      openLatest: z.boolean().default(false).describe('Whether to open the latest session log'),
    }),
    type: 'readOnly',
  },
  handle: async (context, params, response) => {
    const { limit, openLatest } = params;
    
    response.addResult('📝 Available Session Logs');
    response.addResult('');
    
    // Look for session directories in the output directory
    const outputDir = path.dirname(context.config.browser.launchOptions.tracesDir || './output');
    
    if (!fs.existsSync(outputDir)) {
      response.addResult('❌ No output directory found.');
      response.addResult(`Expected location: ${outputDir}`);
      return;
    }
    
    const sessionDirs = fs.readdirSync(outputDir, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory() && dirent.name.startsWith('session-'))
      .map(dirent => {
        const sessionPath = path.join(outputDir, dirent.name);
        const sessionMdPath = path.join(sessionPath, 'session.md');
        const stats = fs.statSync(sessionPath);
        
        return {
          name: dirent.name,
          path: sessionPath,
          logFile: sessionMdPath,
          hasLog: fs.existsSync(sessionMdPath),
          created: stats.ctime,
          modified: stats.mtime
        };
      })
      .sort((a, b) => b.created.getTime() - a.created.getTime())
      .slice(0, limit);
    
    if (sessionDirs.length === 0) {
      response.addResult('❌ No session logs found.');
      response.addResult('');
      response.addResult('💡 To create session logs:');
      response.addResult('   1. Use browser_start_user_session tool');
      response.addResult('   2. Perform manual interactions');
      response.addResult('   3. Use browser_end_user_session tool');
      return;
    }
    
    response.addResult(`Found ${sessionDirs.length} session log(s):`);
    response.addResult('');
    
    sessionDirs.forEach((session, index) => {
      const sessionId = session.name.replace('session-', '');
      response.addResult(`${index + 1}. **Session ${sessionId}**`);
      response.addResult(`   📅 Created: ${session.created.toLocaleString()}`);
      response.addResult(`   📝 Modified: ${session.modified.toLocaleString()}`);
      response.addResult(`   📂 Location: ${session.path}`);
      
      if (session.hasLog) {
        const logStats = fs.statSync(session.logFile);
        const logSize = (logStats.size / 1024).toFixed(2);
        response.addResult(`   📄 Log Size: ${logSize} KB`);
        response.addResult(`   📋 Log File: ${session.logFile}`);
      } else {
        response.addResult(`   ⚠️ No session.md found`);
      }
      
      response.addResult('');
    });
    
    if (openLatest && sessionDirs.length > 0 && sessionDirs[0].hasLog) {
      response.addResult('📖 Opening latest session log...');
      const latestLog = sessionDirs[0].logFile;
      try {
        const logContent = await fs.promises.readFile(latestLog, 'utf-8');
        response.addResult('');
        response.addResult('=' .repeat(50));
        response.addResult(logContent);
        response.addResult('=' .repeat(50));
      } catch (error) {
        response.addError(`Failed to read session log: ${error}`);
      }
    }
  },
});

export default [browserOpenTraceViewer, browserListSessionLogs];