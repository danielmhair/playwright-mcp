> Okay, its seem like we almost have to hack it to get it to work. Because we absolutely cannot have use the locator.<action> methods because it will
  perform it. It is best to manually update them or create a new method that will do it for us. We are going against the system and how its suppose to,
  but this shouldn't be difficult since the issue actually just like the codegen which outputs what the user did in a spec file, but in our case, we are
  attaching it to the trace, if that makes sense.

● Absolutely! You're spot on - this is exactly like the codegen functionality that Playwright already has. Codegen watches user interactions and
  generates test code without actually executing it. We need to do the same thing but inject the trace entries directly.

  You're right that using locator.click() etc. will actually perform the actions, which we absolutely don't want. We need to manually inject trace
  entries into the trace format without going through Playwright's API.

  This makes perfect sense because:

  1. Codegen already does this - it captures user actions and converts them to code
  2. Trace format is just JSON - we can write the entries directly
  3. We have all the data - selector, action type, timing, page context
  4. It's architectural clean - we're not fighting the system, we're extending it

  The Right Approach: Manual Trace Entry Injection

  Instead of trying to execute Playwright API calls, let's write the trace entries directly to the trace format. We can:

  1. Capture the human action data (we already do this)
  2. Generate proper trace entry JSON with the right class: "Locator", method: "click" format
  3. Inject it directly into the trace stream somehow
  4. Include proper before/after snapshots and element targeting

  The question is: How do we inject trace entries directly?

  Looking at the trace format, we need to find either:
  - A way to write directly to the trace file/stream
  - An internal Playwright API that lets us inject custom trace entries with specific class/method
  - Hook into the trace writing mechanism

  Let me investigate how to access Playwright's trace writing internals so we can inject the properly formatted trace entries without executing the
  actions.

  This is the right direction - we're basically creating a "trace codegen" that mirrors what visual codegen does but outputs to the trace format instead
   of test files! 🎯![alt text](image.png)