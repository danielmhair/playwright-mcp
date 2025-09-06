# PRD: Session Management & Action Data Architecture

**Document ID**: PRD-002  
**Created**: 2025-01-15  
**Status**: Draft  
**Related**: issue-734-human-actions.md

## Executive Summary

This PRD defines the architecture for scalable human action recording and session management in Playwright MCP Server, supporting long recording sessions (1-2 hours) without memory issues or processing delays.

## Problem Statement

### Current Issues
1. **Data Flow Disconnection**: Action data captured in `_recordHumanAction` is lost during post-processing
2. **Memory Accumulation**: Long sessions cause unbounded memory growth
3. **File Size Concerns**: Single trace files become unwieldy for extended sessions
4. **Processing Performance**: Real-time processing creates recording delays

### Success Criteria
- ✅ Support 1-2 hour recording sessions without performance degradation
- ✅ Eliminate memory buildup during recording
- ✅ Maintain full visual context (screenshots always enabled)
- ✅ Zero processing during active recording
- ✅ Seamless correlation between trace events and action data

## Technical Architecture

### 1. File-Based Action Storage

**Implementation**: Replace in-memory action storage with persistent file-based system

```
session-{timestamp}/
├── trace-001.zip          # Playwright trace (75 actions max)
├── actions-001.jsonl      # Action metadata (newline-delimited JSON)
├── trace-002.zip          # Next segment
├── actions-002.jsonl      # Corresponding action data
└── session-manifest.json  # Session metadata & segment index
```

**Action File Format (.jsonl)**:
```jsonl
{"timestamp": 1642265400000, "callId": "call@1", "action": {"name": "click", "selector": "button#submit", "text": null}}
{"timestamp": 1642265401000, "callId": "call@2", "action": {"name": "fill", "selector": "input[name='email']", "text": "user@example.com"}}
```

**Benefits**:
- Persistent storage survives crashes
- No memory accumulation
- Easy correlation with trace events
- Consistent JSONL format with trace files

### 2. Action-Based Segmentation

**Segmentation Strategy**: Split sessions every 75 human actions (not time-based)

**Rationale**:
- Playwright trace viewer optimized for ~75 actions
- Predictable file sizes regardless of session duration
- Each segment remains fully functional
- Easy testing and threshold tuning

**Rotation Trigger**:
```typescript
class SessionManager {
  private actionCount = 0;
  private readonly MAX_ACTIONS_PER_SEGMENT = 75;
  
  async recordAction(action: ActionData) {
    await this.appendToActionFile(action);
    this.actionCount++;
    
    if (this.actionCount >= this.MAX_ACTIONS_PER_SEGMENT) {
      await this.rotateSegment();
    }
  }
}
```

### 3. Synchronized Rotation

**Rotation Process** (maintains perfect sync):
1. Stop current trace → `trace-N.zip` created
2. Close current action file → `actions-N.jsonl` finalized  
3. Start new trace immediately → `trace-N+1`
4. Open new action file → `actions-N+1.jsonl`

**Implementation**:
```typescript
async rotateSegment() {
  // 1. Stop current trace
  const tracePath = await this.browserContext.tracing.stop({ 
    path: `trace-${this.segmentNumber}.zip` 
  });
  
  // 2. Close action file
  await this.closeActionFile();
  
  // 3. Start new trace
  await this.browserContext.tracing.start({ 
    name: `trace-${++this.segmentNumber}`,
    screenshots: true,
    snapshots: true,
    sources: true
  });
  
  // 4. Open new action file
  await this.openActionFile(`actions-${this.segmentNumber}.jsonl`);
  
  // 5. Reset counter
  this.actionCount = 0;
}
```

## Implementation Plan

### Phase 1: Action File Storage
**Files Modified**: `src/context.ts`

1. **Add ActionFileWriter class**
   ```typescript
   class ActionFileWriter {
     private fileHandle: FileHandle;
     
     async append(action: ActionData): Promise<void> {
       await this.fileHandle.write(JSON.stringify(action) + '\n');
     }
     
     async close(): Promise<void> {
       await this.fileHandle.close();
     }
   }
   ```

2. **Modify _recordHumanAction**
   ```typescript
   private async _recordHumanAction(actionName: string, page: Page, data: ActionInContext) {
     // Store action data to file
     await this.actionWriter.append({
       timestamp: performance.now(),
       callId: data.callId,
       action: data.action
     });
     
     // Trigger boundingBox as before
     await locator.boundingBox({ timeout: 1000 });
     
     // Check rotation
     await this.checkRotation();
   }
   ```

### Phase 2: Segment Management
**Files Modified**: `src/context.ts`, `src/tools/userSession.ts`

1. **Add SessionSegmentManager**
   ```typescript
   class SessionSegmentManager {
     private segments: string[] = [];
     private currentSegment = 1;
     private actionCount = 0;
     
     async startNewSegment(): Promise<void> { /* rotation logic */ }
     async finalizeSession(): Promise<SessionResult> { /* combine segments */ }
   }
   ```

2. **Update user session tools**
   - `browser_start_user_session`: Initialize segment manager
   - `browser_end_user_session`: Return all segment paths for post-processing

### Phase 3: Post-Processing Enhancement
**Files Modified**: `src/context.ts` (postProcessTraceFile method)

1. **Segment-Aware Processing**
   ```typescript
   async processSession(sessionDir: string): Promise<string[]> {
     const segments = await this.getSessionSegments(sessionDir);
     const processedSegments: string[] = [];
     
     for (const segment of segments) {
       const traceFile = segment.trace;
       const actionFile = segment.actions;
       
       // Load action data
       const actions = await this.loadActionData(actionFile);
       
       // Process trace with action context
       const enhanced = await this.enhanceTraceWithActions(traceFile, actions);
       processedSegments.push(enhanced);
     }
     
     return processedSegments;
   }
   ```

### Phase 4: Integration & Testing
**Testing Strategy**:
- Single segment sessions (< 75 actions)
- Multi-segment sessions (200+ actions)
- Long duration sessions (1-2 hours)
- Memory usage monitoring
- File size validation

## Performance Specifications

### File Size Estimates
- **Action file**: ~200 bytes per action
- **Trace segment**: ~75-100MB (with screenshots)
- **2-hour session**: ~400-500MB total (segmented)

### Memory Requirements  
- **Constant memory usage** (no accumulation)
- **Action file buffer**: < 1MB
- **Trace buffer**: Playwright-managed

### Processing Performance
- **Recording**: Zero processing overhead
- **Post-processing**: Parallel segment processing
- **Memory**: Bounded by segment size, not session duration

## Risk Assessment

### Technical Risks
| Risk | Impact | Mitigation |
|------|--------|------------|
| File I/O errors | High | Atomic writes, error recovery |
| Segment correlation failures | Medium | Timestamp + callId matching |
| Disk space exhaustion | Low | Configurable cleanup policies |

### Performance Risks
| Risk | Impact | Mitigation |
|------|--------|------------|
| Large trace files | Low | Segmentation limits size |
| Post-processing memory | Medium | Stream processing |
| Concurrent file access | Low | File locking |

## Success Metrics

### Functional Requirements
- ✅ Session duration: Support 2+ hours
- ✅ Action correlation: 100% accuracy
- ✅ File integrity: No data loss during rotation
- ✅ Visual quality: Full screenshots maintained

### Performance Requirements
- ✅ Memory usage: Constant (< 100MB regardless of session length)
- ✅ Recording latency: < 50ms per action
- ✅ File size: < 100MB per segment
- ✅ Post-processing: < 30s per segment

## Future Considerations

### Scalability Extensions
- Configurable segment thresholds
- Compression options for long-term storage  
- Background cleanup of old sessions
- Streaming post-processing for very long sessions

### Integration Points
- Claude Code MCP client compatibility
- Trace viewer enhancements
- CI/CD integration for automated testing
- Monitoring and alerting for production use

---

**Approval Required From**:
- Technical Lead: Architecture review
- Product: Feature requirements validation  
- QA: Testing strategy approval