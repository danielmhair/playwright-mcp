# PRD: Human Action Recording and Trace Generation

**Issue**: [#734 - Playwright MCP support to record human actions](https://github.com/microsoft/playwright-mcp/issues/734)

**Status**: Implementation Phase  
**Priority**: High  
**Assigned**: Development Team

## Overview

Enable Playwright MCP to record human actions performed in the browser and generate comprehensive Playwright traces that include both MCP tool interactions and manual user interactions. This feature addresses the need for developers to capture complete browser session workflows that combine automated MCP tools with manual user actions.

## Problem Statement

Currently, the Playwright MCP server can:
- Execute automated browser actions via MCP tools
- Generate traces when using `--save-trace` flag
- Record human actions via `InputRecorder` class

However, there's a critical gap: **human actions are not included in the generated traces** because the `InputRecorder` is disabled during tool execution. Users need a way to:

1. Start a browser session via MCP
2. Perform manual interactions (clicking, typing, navigating)
3. Retrieve a complete trace.zip file containing all interactions
4. Use this trace for debugging, documentation, or automation development

## Success Criteria

### Primary Goals
- [ ] Enable continuous recording of human actions during browser sessions
- [ ] Generate Playwright traces that include both MCP tools and human interactions
- [ ] Provide explicit tools to start/stop user interaction recording sessions
- [ ] Maintain backward compatibility with existing trace generation

### Secondary Goals
- [ ] Support multiple user session traces within a single browser instance
- [ ] Provide clear separation between tool-driven and human-driven actions in traces
- [ ] Enable VS Code extension integration for trace file retrieval
- [ ] Maintain performance while recording human actions

## User Stories

### Story 1: Manual Testing with Trace Generation
**As a** QA engineer  
**I want to** manually test a web application while MCP records my actions  
**So that** I can generate a trace file for bug reproduction and documentation

### Story 2: Hybrid Automation Development
**As a** automation developer  
**I want to** use MCP tools to set up test conditions, then manually perform complex interactions  
**So that** I can capture the complete workflow in a trace for later automation

### Story 3: Debug Session Recording
**As a** developer  
**I want to** record my debugging session interactions in a browser opened by MCP  
**So that** I can share the complete reproduction steps with my team

## Technical Requirements

### Functional Requirements

1. **New MCP Tools**
   - `browser_start_user_session`: Initialize human action recording
   - `browser_end_user_session`: Finalize session and retrieve trace file

2. **Configuration Options**
   - `--save-trace-with-user-actions`: Enable trace generation with human actions
   - `--record-user-actions`: Enable action recording without trace generation

3. **Session Management**
   - Track active user session state
   - Handle session boundaries in traces
   - Support multiple sessions per browser instance

4. **Trace Integration**
   - Include human actions in Playwright traces
   - Distinguish between tool and human actions
   - Maintain trace file compatibility

### Non-Functional Requirements

1. **Performance**
   - Minimal impact on browser performance during recording
   - Efficient trace file generation and storage

2. **Reliability**
   - Graceful handling of browser crashes during recording
   - Recovery from interrupted sessions
   - Proper cleanup of trace resources

3. **Usability**
   - Clear feedback when recording is active
   - Intuitive tool naming and parameters
   - Comprehensive error messages

## Architecture Design

### Current System Analysis

```
BrowserServerBackend
├── Context (manages browser contexts)
├── InputRecorder (captures human actions - CURRENTLY DISABLED during tools)
├── SessionLog (logs actions to markdown)
└── Tools (MCP tool handlers)
```

### Proposed Changes

```
BrowserServerBackend
├── Context (enhanced with session management)
├── InputRecorder (continuous recording capability)
├── SessionLog (enhanced with trace integration)
├── UserSessionManager (new - manages session state)
└── Tools (including new user session tools)
```

### Key Components

1. **Enhanced InputRecorder**
   - Configurable enable/disable behavior
   - Session boundary markers in traces
   - Improved action flushing

2. **New User Session Tools**
   - Session lifecycle management
   - Trace file generation and retrieval
   - State validation and error handling

3. **Configuration System Updates**
   - New CLI flags and environment variables
   - Enhanced config validation
   - Backward compatibility maintenance

## Implementation Plan

### Phase 1: Core Infrastructure (Week 1)
- [ ] Add new configuration options and CLI flags
- [ ] Enhance Context class with session management methods
- [ ] Modify InputRecorder enable/disable logic

### Phase 2: User Session Tools (Week 1)
- [ ] Implement `browser_start_user_session` tool
- [ ] Implement `browser_end_user_session` tool
- [ ] Update tool registration and exports

### Phase 3: Trace Integration (Week 2)
- [ ] Enhance trace generation for user sessions
- [ ] Add session boundary markers
- [ ] Implement trace file attachment in responses

### Phase 4: Testing and Documentation (Week 2)
- [ ] Create comprehensive test suite
- [ ] Update CLI help and documentation
- [ ] Add example usage to README

### Phase 5: Integration and Polish (Week 3)
- [ ] VS Code extension integration points
- [ ] Performance optimization
- [ ] Error handling improvements

## Technical Specifications

### New Configuration Options

```typescript
export type CLIOptions = {
  // Existing options...
  saveTraceWithUserActions?: boolean;
  recordUserActions?: boolean;
};
```

### Tool Schemas

```typescript
// browser_start_user_session
{
  name: 'browser_start_user_session',
  description: 'Start recording human user actions in the browser session',
  inputSchema: {
    type: 'object',
    properties: {
      enableTracing: { type: 'boolean', default: true }
    }
  }
}

// browser_end_user_session  
{
  name: 'browser_end_user_session',
  description: 'End user action recording session and retrieve trace file',
  inputSchema: {
    type: 'object', 
    properties: {
      closeAfter: { type: 'boolean', default: false }
    }
  }
}
```

### Context Enhancements

```typescript
class Context {
  // New methods
  async flushInputRecorder(): Promise<void>
  async getUserSessionTraceFile(): Promise<string | undefined>
  async createUserSessionTrace(): Promise<string>
  
  // Enhanced session state tracking
  private _userSessionActive: boolean = false
}
```

## Risk Assessment

### High Risk
- **Backward Compatibility**: Changes to InputRecorder behavior could affect existing functionality
- **Performance Impact**: Continuous recording may impact browser performance
- **Trace File Corruption**: Interrupted sessions could create invalid trace files

### Medium Risk
- **Complex State Management**: Managing session state across tool calls
- **File System Handling**: Managing multiple trace files and cleanup
- **Error Recovery**: Handling browser crashes during recording

### Low Risk
- **Tool Integration**: Adding new tools to existing system
- **Configuration Changes**: Adding new CLI flags and options

### Mitigation Strategies

1. **Comprehensive Testing**: Multi-browser test suite with session scenarios
2. **Graceful Degradation**: Fallback behavior when recording fails
3. **State Validation**: Robust session state checks before operations
4. **Resource Management**: Automatic cleanup of trace files and resources

## Success Metrics

### Functional Metrics
- [ ] New tools work across all supported browsers (Chrome, Firefox, WebKit)
- [ ] Generated traces include both tool and human actions
- [ ] Trace files are valid and playable in Playwright Trace Viewer
- [ ] Session state is properly managed across tool calls

### Performance Metrics
- [ ] <10% performance overhead during recording
- [ ] Trace file generation completes in <5 seconds
- [ ] Memory usage increase <50MB during typical sessions

### Quality Metrics
- [ ] Test coverage >90% for new functionality
- [ ] Zero regressions in existing trace functionality
- [ ] All error conditions handled gracefully

## Timeline

**Week 1**: Core infrastructure and tool implementation  
**Week 2**: Trace integration and testing  
**Week 3**: Polish, documentation, and integration

**Estimated Effort**: 3 weeks  
**Target Release**: Next minor version

## Dependencies

- Existing Playwright MCP infrastructure
- Playwright tracing APIs
- MCP SDK tool registration system
- File system access for trace storage

## Future Enhancements

1. **Advanced Session Management**: Support for nested sessions and session templates
2. **Trace Analysis Tools**: Built-in trace analysis and reporting capabilities  
3. **Cloud Integration**: Upload traces to cloud storage services
4. **Real-time Streaming**: Stream actions to external systems in real-time

## Approval

**Product Owner**: _Pending_  
**Engineering Lead**: _Pending_  
**QA Lead**: _Pending_

---

**Document Version**: 1.0  
**Last Updated**: Current Date  
**Next Review**: Implementation Completion