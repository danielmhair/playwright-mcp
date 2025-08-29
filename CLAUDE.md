# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is the **Playwright MCP Server** - a Model Context Protocol (MCP) server that provides browser automation capabilities using Playwright. It enables LLMs to interact with web pages through structured accessibility snapshots instead of screenshots.

Key characteristics:
- **TypeScript-first**: All source code in TypeScript with strict compilation
- **MCP SDK integration**: Uses `@modelcontextprotocol/sdk` for server implementation  
- **Multi-browser support**: Chrome, Firefox, Safari/WebKit with both headed and headless modes
- **Accessibility-focused**: Uses Playwright's accessibility tree rather than visual/pixel-based automation
- **Capability system**: Modular tool system with optional capabilities (vision, pdf, tabs, install)

## Development Commands

### Build & Compilation
```bash
npm run build          # Compile TypeScript to ./lib directory
npm run watch          # Watch mode compilation
npm run clean          # Remove ./lib directory
```

### Code Quality
```bash
npm run lint           # Full lint (updates README + ESLint + type check)
npm run lint-fix       # Auto-fix ESLint issues
```

### Testing
```bash
npm test               # Run all tests across all browsers
npm run ctest          # Chrome-only tests
npm run ftest          # Firefox-only tests  
npm run wtest          # WebKit-only tests
```

**Test-specific commands**:
- Use `--project=chrome` for Chrome-specific testing
- Set `MCP_IN_DOCKER=1` for Docker-based testing
- Set `PWMCP_DEBUG=1` for verbose test output
- Tests use custom fixtures in `tests/fixtures.ts`

### Running the Server
```bash
npm run run-server     # Start standalone MCP server (after build)
node cli.js            # Direct CLI execution with arguments

# User session recording options
node cli.js --save-trace-with-user-actions    # Enable user action tracing
node cli.js --record-user-actions             # Enable action recording without traces
```

## Architecture Overview

### Core System Design
```
cli.js → src/index.ts → BrowserServerBackend → Context → Tools
                    ↓
               MCP Server (SDK) → Tool Handlers → Playwright Actions
```

**Key Components**:
- **BrowserServerBackend** (`src/browserServerBackend.ts`): Main backend implementing MCP `ServerBackend` interface
- **Context** (`src/context.ts`): Browser context manager with tab management and input recording
- **Tools System** (`src/tools.ts`): Capability-based tool filtering and registration
- **SessionLog** (`src/sessionLog.ts`): Records user actions and tool responses for session persistence

### Tool Architecture

**Tool Categories** (in `src/tools/`):
- **Core automation**: `common.ts`, `mouse.ts`, `keyboard.ts`, `navigate.ts`
- **Page interaction**: `snapshot.ts`, `evaluate.ts`, `wait.ts`
- **Data & files**: `files.ts`, `screenshot.ts`, `console.ts`, `network.ts`
- **User session**: `userSession.ts` - Tools for recording human actions and generating traces
- **Optional capabilities**: `tabs.ts` (tabs), `pdf.ts` (pdf), `install.ts` (install), vision tools (vision)

**Tool Definition Pattern**:
```typescript
export const toolName = defineTool({
  capability: 'core' | 'tabs' | 'pdf' | 'vision' | 'install',
  schema: { /* MCP schema */ },
  handle: async (context, params, response) => { /* implementation */ }
});
```

### Configuration System

**Config Sources** (in order of precedence):
1. CLI arguments (`--headless`, `--browser=chrome`, etc.)
2. Environment variables (`PLAYWRIGHT_MCP_*`)
3. JSON config file (`--config=path/to/config.json`)
4. Default configuration

**Key Config Areas**:
- **Browser**: Type, launch options, context options, CDP endpoint
- **Network**: Origin allowlist/blocklist, proxy settings
- **Capabilities**: Which tool groups to enable
- **Output**: Session logging, trace saving, file locations
- **User Sessions**: Human action recording and trace generation with user interactions

### Tab & Context Management

**Browser Lifecycle**:
- `BrowserContextFactory` creates browser contexts (isolated or persistent)
- `Context` manages multiple tabs with current tab selection
- `Tab` wraps Playwright pages with modal state tracking
- `InputRecorder` captures user actions for session logging when enabled

### MCP Integration Points

**Server Creation** (`src/mcp/server.ts`):
- Generic MCP server factory with tool registration
- Zod schema to JSON Schema conversion for tool definitions  
- Error handling and response serialization
- Heartbeat mechanism for client connection health

**Response Format**:
- Structured sections: Result, Code, Page state, Console messages, Modal state
- Attachment support for screenshots and files
- Error state propagation

## Testing Framework

**Test Structure**:
- **Fixtures** (`tests/fixtures.ts`): Custom Playwright test fixtures for MCP client setup
- **Test Options**: Browser selection, Docker mode, headless mode
- **Multi-browser**: All tests run across Chrome, Firefox, WebKit automatically
- **Integration**: Tests actual MCP client-server communication

**Test Execution Flow**:
1. Start MCP server process with test configuration
2. Create MCP client with stdio transport
3. Execute browser automation tools via MCP
4. Validate responses and browser state
5. Clean up browser and server resources

## Key Implementation Patterns

### Tool Error Handling
- Tools throw exceptions for user-facing errors
- `Response.addError()` for structured error reporting
- Modal state validation prevents invalid tool usage
- Context validation ensures browser/page availability

### Session & Trace Management
- Session logs saved as markdown with tool calls and user actions
- Playwright traces saved as ZIP files when `--save-trace` enabled
- Input recorder captures human actions during manual browser interaction
- Output directory structure: `session-{timestamp}/` with `.md` and `.yml` files

### Browser Context Isolation
- **Persistent**: Regular browser profile with saved state between sessions
- **Isolated**: Temporary profile, cleared on close
- **CDP**: Connect to existing browser via Chrome DevTools Protocol

### User Session Recording

**New Feature (Issue #734)**: Record human actions and generate Playwright traces containing both MCP tool interactions and manual user actions.

**Core Tools**:
- `browser_start_user_session`: Start recording human actions in browser session
- `browser_end_user_session`: End recording and retrieve trace file with all interactions

**Configuration Options**:
- `--save-trace-with-user-actions`: Enable trace generation including human actions
- `--record-user-actions`: Enable action recording without trace generation

**Workflow**:
1. Start MCP server with user action recording enabled (DO NOT use --headless!)
2. Use `browser_start_user_session` to begin recording
3. Perform manual interactions (clicking, typing, navigating) in the headed browser window
4. Use `browser_end_user_session` to get trace.zip file (browser stays open for manual review)
5. Trace contains both MCP tool actions and human interactions
6. Manually close browser when done

**Important**: Never use `--headless` with user session recording - humans need to see and interact with the browser!

**Key Implementation Details**:
- InputRecorder remains active during tool execution when user sessions are active
- Session state tracking prevents invalid operations
- Trace files include session boundary markers
- Support for custom trace filenames and browser closure options

### Performance & Resource Management
- Lazy browser context creation (only when first tool needs it)
- Automatic cleanup on server shutdown
- Resource disposal through context.dispose()
- Debug logging with `DEBUG=pw:mcp:*` environment variable