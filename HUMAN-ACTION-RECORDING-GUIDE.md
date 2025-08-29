# 🎬 Human Action Recording Guide

## Overview

This guide explains how to use Playwright MCP's dual-output human action recording system to capture, analyze, and debug browser interactions.

## 📊 Dual Recording System

When you record a user session, you get **two complementary outputs**:

### 1. 📦 Playwright Trace (.zip)
- **Screenshots** at each step with full page snapshots
- **Network activity** including requests, responses, and timing
- **Browser state** with DOM snapshots and console logs
- **Performance metrics** and resource usage

### 2. 📝 Session Log (.md)
- **Human interaction timeline** with detailed action breakdown
- **Element selectors** and target information
- **Timing data** with precise timestamps
- **Generated code** showing programmatic equivalents

## 🚀 Quick Start

### 1. Start Recording Session

```javascript
// Using MCP client
await client.callTool({
  name: 'browser_start_user_session',
  arguments: { enableTracing: true }
});
```

### 2. Perform Manual Interactions
- Click, type, scroll, navigate in the browser
- All actions are automatically captured
- No interference with your interactions

### 3. End Session and Get Results

```javascript
await client.callTool({
  name: 'browser_end_user_session',
  arguments: { 
    filename: 'my-test-session',
    closeAfter: false 
  }
});
```

## 🛠️ Available Tools

### Core Recording Tools

#### `browser_start_user_session`
Starts recording human interactions.

**Parameters:**
- `enableTracing` (boolean): Enable Playwright trace recording

**Example:**
```json
{
  "enableTracing": true
}
```

#### `browser_end_user_session`
Ends recording and generates output files.

**Parameters:**
- `filename` (string, optional): Custom name for trace file
- `closeAfter` (boolean): Whether to close browser after ending

**Example:**
```json
{
  "filename": "user-workflow-test",
  "closeAfter": false
}
```

### Analysis Tools

#### `browser_open_trace_viewer`
Opens Playwright trace viewer for visual analysis.

**Parameters:**
- `traceFile` (string, optional): Path to trace file (lists all if omitted)
- `port` (number): Port for trace viewer (default: 9323)
- `openBrowser` (boolean): Auto-open browser (default: true)

**Examples:**
```json
// List all available traces
{}

// Open specific trace
{
  "traceFile": "/path/to/trace.zip",
  "port": 9323
}
```

#### `browser_list_session_logs`
Lists all available session logs with human interaction timelines.

**Parameters:**
- `limit` (number): Maximum sessions to list (default: 10)
- `openLatest` (boolean): Show latest session content (default: false)

**Example:**
```json
{
  "limit": 5,
  "openLatest": true
}
```

## 📋 Command Line Options

### Starting with Recording Enabled

```bash
# Enable trace recording with user actions
node cli.js --save-trace-with-user-actions

# Enable continuous user action recording
node cli.js --record-user-actions

# Combine both for full recording
node cli.js --save-trace-with-user-actions --record-user-actions
```

### Environment Variables

```bash
# Configure traces directory
export PLAYWRIGHT_MCP_TRACES_DIR="/path/to/traces"

# Enable user session recording by default
export PLAYWRIGHT_MCP_RECORD_USER_ACTIONS=true
```

## 🎯 Use Cases

### 1. Bug Reproduction
**Scenario:** User reports an issue that's hard to reproduce.

**Workflow:**
1. Start user session with tracing
2. Have user perform the problematic workflow
3. End session to get both trace and detailed log
4. Use trace viewer for visual debugging
5. Use session log for step-by-step analysis

### 2. User Experience Testing
**Scenario:** Testing how users interact with your application.

**Workflow:**
1. Start recording session
2. Give user tasks to complete
3. Let them interact naturally
4. Analyze both visual trace and interaction patterns
5. Identify usability issues and optimization opportunities

### 3. Automated Test Generation
**Scenario:** Convert user actions into automated tests.

**Workflow:**
1. Record user performing desired workflow
2. Extract action sequence from session log
3. Use generated code as basis for automated tests
4. Verify with trace screenshots for expected states

### 4. Performance Analysis
**Scenario:** Understanding performance impact of user interactions.

**Workflow:**
1. Record session with performance-heavy interactions
2. Use trace viewer to analyze network timing
3. Use session log to correlate actions with performance
4. Identify optimization opportunities

## 📊 Output File Structure

### Session Directory Structure
```
session-1640995200000/
├── session.md              # Human interaction timeline
├── 001.snapshot.yml        # Page snapshot for action 1
├── 001.screenshot.png      # Screenshot for action 1
├── 002.snapshot.yml        # Page snapshot for action 2
└── trace.zip               # Playwright trace file
```

### Session Log Format
```markdown
# 🎬 Playwright MCP Session Recording

## 📊 Dual Recording System
[System information and configuration]

---

## 🎯 Human Interaction Timeline

### 001. [14:32:15] 🖱️ Click (25ms)
**Tab:** https://example.com
**Target Element:** `button[data-testid="submit"]`
**Button:** left
**Click Count:** 1

**Generated Code:**
```javascript
await page.locator('button[data-testid="submit"]').click();
```

**Page Snapshot:** [001.snapshot.yml](001.snapshot.yml)

---

### 002. [14:32:16] ⌨️ Fill (150ms)
**Tab:** https://example.com/form
**Target Element:** `input[name="username"]`
**Text Entered:** "testuser"

**Generated Code:**
```javascript
await page.locator('input[name="username"]').fill('testuser');
```
```

## 🔍 Analysis Workflows

### Visual Analysis (Trace Viewer)
1. Open trace with `browser_open_trace_viewer`
2. Navigate through timeline using screenshots
3. Inspect network requests and responses
4. Examine DOM snapshots at each step
5. Analyze performance metrics

### Interaction Analysis (Session Log)
1. List sessions with `browser_list_session_logs`
2. Review detailed action timeline
3. Examine element selectors and targets
4. Check timing and sequence of actions
5. Extract generated code for automation

### Combined Analysis
1. Use trace viewer for visual context
2. Use session log for detailed action data
3. Cross-reference timestamps between both
4. Identify patterns and issues
5. Generate comprehensive reports

## 🚨 Best Practices

### Recording Sessions
- ✅ Always use headed browser mode for human interactions
- ✅ Start recording before any user actions
- ✅ Let users interact naturally without guidance
- ✅ End recording promptly to save resources
- ✅ Use descriptive filenames for sessions

### Analysis
- ✅ Start with trace viewer for visual overview
- ✅ Use session log for detailed action analysis
- ✅ Cross-reference both outputs for complete picture
- ✅ Focus on user intent vs. technical implementation
- ✅ Document insights and patterns discovered

### Performance
- ✅ Limit recording duration for large sessions
- ✅ Clean up old trace files regularly
- ✅ Use specific filenames to organize recordings
- ✅ Consider network impact of trace generation
- ✅ Store traces in appropriate locations

## 🐛 Troubleshooting

### Common Issues

#### No Actions Recorded
**Symptoms:** Empty session log or minimal trace data
**Solutions:**
- Verify browser is in headed mode (not --headless)
- Ensure recording was started before interactions
- Check that user actions are actual DOM events
- Verify InputRecorder is enabled in configuration

#### Trace Viewer Won't Open
**Symptoms:** Error opening trace or viewer doesn't start
**Solutions:**
- Verify Playwright is installed: `npm list playwright`
- Check trace file exists and is valid .zip
- Try different port with `port` parameter
- Ensure no other processes using the same port

#### Large File Sizes
**Symptoms:** Trace files are very large or slow to generate
**Solutions:**
- Limit recording session duration
- Disable screenshots if not needed
- Use specific trace configuration options
- Clean up old traces regularly

## 📚 Advanced Usage

### Custom Configuration

```javascript
// Start session with custom trace settings
await client.callTool({
  name: 'browser_start_user_session',
  arguments: { 
    enableTracing: true,
    // Custom trace settings would be configured via CLI/env
  }
});
```

### Integration with CI/CD

```bash
#!/bin/bash
# Example: Record user acceptance tests
start_session_id=$(node -e "
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
// Start session, perform tests, end session
// Extract and archive trace files
")
```

### Automated Analysis

```javascript
// Example: Extract action patterns from session logs
const fs = require('fs');
const sessionLog = fs.readFileSync('session.md', 'utf-8');

// Parse and analyze interaction patterns
const actions = parseSessionActions(sessionLog);
const insights = analyzeUserBehavior(actions);
```

## 🎉 Conclusion

The dual-output human action recording system provides comprehensive debugging and analysis capabilities by combining:

- **Visual debugging** through Playwright traces
- **Detailed interaction analysis** through session logs
- **Complete workflow capture** without interference
- **Flexible analysis tools** for different use cases

This approach gives you all the information needed to understand, debug, and optimize user interactions in your applications.