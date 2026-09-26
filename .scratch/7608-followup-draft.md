## Follow-up: the confirmation source was wrong in my last comment

My previous comment recommended a `tool_call` handler that reads session history for the user's own affirmative. **Withdrawing that half.** The enforcement point was right; the confirmation source was not.

### Why it was wrong

Reading conversation history for a user-shaped "yes" keeps consent inside the model's token stream. That is the same channel #7562 already defeated — it just moves the check from the prompt to a handler. Two concrete weaknesses found while designing it:

- On resume, `prependResumeSeed` splices the previous worker's agent-authored digest *inside* the user's own message (`services/langyworker/src/system-prompt.ts:43-53`, called from `src/runner.ts:184`), so agent-authored text can occupy a user-role entry.
- Session entries are re-parsed from on-disk JSONL with no integrity check (`core/session-manager.js:98`, `:269`; no HMAC/signature/checksum anywhere in that file). An agent holding `write` and `bash` can append a forged `role: "user"` line that loads as genuine on the next session. Detail is tracked privately; not restating it here.

Live sessions are safe — `getBranch()` walks the in-memory map (`core/session-manager.js:943-953`), not the file — but a gate that has to reason about which history entries are trustworthy is the wrong design regardless.

### What the standard actually is

This is a solved pattern everywhere else, and the shared invariant is that approval is **out-of-band**: collected by the harness, never expressible as a token the model could have emitted.

- **MCP** standardizes it as elicitation — the server requests, *the client* collects from the user, and the reply is a structured `accept` / `decline` / `cancel`.
- **Claude Code** fires `PreToolUse` "Before a tool call executes. Can block it," returning a `permissionDecision`, over a permission system where Bash commands are "Approval required: Yes" and manual mode "asks before the action runs." Notably: "The hook can deny the call, but staying silent doesn't approve it."

### The SDK already gives us this

`ExtensionContext.ui` exposes `confirm(title, message, opts?): Promise<boolean>` (`core/extensions/types.d.ts:68-192`). A `tool_call` handler can `await ctx.ui.confirm(...)` and return `{ block: !approved }`. **The hard part — pausing an agent mid-tool-call and waiting on a human — is already solved by the SDK.** No new pause semantics need inventing in the worker.

And the seam is ours: `bindExtensions(bindings: ExtensionBindings): Promise<void>` is public (`core/agent-session.d.ts:506`) and `ExtensionBindings.uiContext?: ExtensionUIContext` (`:145-151`). `services/langyworker/src/session.ts:152` already holds the `AgentSession` returned by `createAgentSession(...)`. So we can supply our own `uiContext` whose `confirm()` routes out over the stdio protocol to the web chat and awaits a real answer — no fork, no SDK bypass. The SDK's own `CreateAgentSessionResult.extensionsResult` is annotated "for UI context setup", i.e. bind-after-create is the intended pattern; langyworker just never exercises it.

### ⚠️ The trap anyone implementing this will hit

The uiContext defaults to `noOpUIContext`, whose confirm is:

```js
confirm: async () => false,
```

It does not throw and does not warn — it silently answers "no". And the default is the failing one: `setUIContext(uiContext, mode = "print") { this.uiContext = uiContext ?? noOpUIContext; }` (`core/extensions/runner.js:267-270`).

langyworker calls `bindExtensions` **nowhere**, and imports none of the SDK run modes, so `hasUI()` is `false` today. Meaning: the textbook-correct implementation — `await ctx.ui.confirm()` inside a `tool_call` handler — would **block every delete, forever, with no error surfaced anywhere**. Fail-closed and completely broken, in a way that looks like nothing happened.

**Requirement:** whatever ships must assert `hasUI()` at startup and refuse to boot rather than degrade quietly.

### Corrections to this issue's own Build bullet

- The gate cannot live in `services/langyagent` (Go). Go sees only post-hoc `tool_start` / `tool_end` and has no veto. It belongs in `services/langyworker/src/` (TypeScript).
- There is no product-level delete tool. Registered tools are `read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`, `todowrite`, `skill` (`services/langyworker/src/session.ts:32-42`), so deletes ride generic `bash`. A handler still has to decide *which* bash commands warrant a prompt — but that classifier now only has to be good enough to decide when to ask a human, not good enough to be the control itself. That is a much weaker requirement than the string-matching gate I previously proposed, and I'd drop that prototype.

### Honest scope

The worker-side pause is free; the transport is not. A real approval round trip still needs: a new protocol frame pair (nothing in `PROTOCOL.md` currently expects a reply, and the documented invariant is terminal-last-per-turn), a non-terminal branch plus a write path in the Go agent, a pending-approval record on the API, and an approve/deny card in the chat UI — no such message kind exists today.

`langwatch ui call` is close prior art for the round trip (server pins a pending action to the live turn, browser claims and completes it, result returns synchronously). Its ceiling is the mismatch: `UI_ACTION_MAX_BUDGET_MS = 15_000`, tied to a 30-second worker command timeout. A human deciding whether to delete something does not fit in fifteen seconds, so the budget model needs rethinking rather than tuning.

None of this is shipped. The prompt-level hardening remains the only thing protecting anything today.
