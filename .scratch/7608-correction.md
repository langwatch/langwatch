## Correction: I was wrong — the structural gate **is** an in-repo code change

Retracting the headline of my earlier comment on this issue ("a structural gate is NOT achievable as an in-repo code change"). That finding was researched against the **opencode** harness. Opencode is being abandoned, and under the harness that actually ships the conclusion reverses.

### Why it reversed

`release_langy_pi_harness` (`platform/app/src/server/app-layer/langy/langyHarness.ts:12`) is **on by default**, so the **pi** harness is what ships. `resolveLangyHarness()` returns `"pi"` unless the flag is explicitly off, and fails open to `"pi"` on a flag-store error.

The pi SDK (`@earendil-works/pi-coding-agent` v0.84.2, driven by `services/langyworker/`) exposes a genuine pre-execution veto — the equivalent of `canUseTool`:

- `on(event: "tool_call", handler: ExtensionHandler<ToolCallEvent, ToolCallEventResult>)` — `dist/core/extensions/types.d.ts:897`
- Doc comment on `ToolCallEvent` (`types.d.ts:685-691`): *"Fired before a tool executes. Can block."*
- `ToolCallEventResult { block?: boolean; reason?: string; terminate?: boolean }` — `types.d.ts:779-788`
- The runtime honors it — `agent-session.js:223-243` wires `agent.beforeToolCall` to `emitToolCall` — and **fails closed**: a non-Error throw becomes `"Extension failed, blocking execution"`.

**langy never registers it.** `services/langyworker/src/` hooks only `before_agent_start`, `session_start`, and `session_tree`. The string `tool_call` appears nowhere in the tree, and the Go-side wire protocol carries only post-hoc `tool_start` / `tool_end`.

So the capability to gate deletes deterministically ships today and is simply unwired.

### One correction to this issue's plan

The **Build** bullet says the structural confirm gate goes "in `services/langyagent`". It can't: the Go manager still only spawns a subprocess (now `langy-worker` over stdio JSONL instead of opencode over HTTP) and still only sees tool calls after they run. The veto point is **inside the worker** — `services/langyworker/src/`, TypeScript — not in Go.

### The wrinkle worth knowing before scoping it

There is **no product-level `delete` tool**. Langy's tools are the SDK built-ins (`read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`) plus two langy-owned ones (`todowrite`, `skill`). Deletes therefore ride **generic `bash`** running the langwatch CLI, so the gate matches delete verbs in the command string. That must fail closed on ambiguity and be pinned by tests. Ordinary engineering — but it is a maintenance surface, not a one-line guard.

### Still genuinely open

For the gate to implement *this issue's* rule it must see a **user-authored** turn, distinguishable from an assistant-authored one — otherwise it can be satisfied by a passphrase Langy wrote itself, which is exactly the #7562 mode B bypass. Whether the handler's `ExtensionContext` exposes role-tagged history is being verified now; if it does not, the required plumbing is the real cost of this work. I'll follow up with that answer.

### What this changes about the decision

The two options in my earlier comment (out-of-band confirm token; credential scoping) are **no longer the primary path** — they are optional extra depth if you want a guarantee that survives an agent with repo write access. The primary path is wiring the handler, which needs no platform decision, no token infra, and no permission-model split.

The prompt/rubric work in #7563 stays correct and complementary, but it is the behavioral layer and it is honestly probabilistic. It is no longer the ceiling.
