## Architecture finding (REVISED) — a structural gate IS achievable as an in-repo code change

> **Correction, supersedes the original finding.** The original concluded that no in-repo structural gate was possible and that the delete guarantee was therefore a one-way platform decision. That was researched against the **opencode** harness. Opencode is being abandoned: `release_langy_pi_harness` (`platform/app/src/server/app-layer/langy/langyHarness.ts:12`) is **ON by default**, so the **pi harness** is what ships. Under pi the conclusion reverses.

### The decisive fact

The pi SDK (`@earendil-works/pi-coding-agent@0.84.2`, driven by `services/langyworker/`) exposes a **real pre-execution veto** — the equivalent of `canUseTool`:

- `on(event: "tool_call", handler: ExtensionHandler<ToolCallEvent, ToolCallEventResult>)` — `dist/core/extensions/types.d.ts:897`
- Doc comment on `ToolCallEvent` (`types.d.ts:685-691`): *"Fired before a tool executes. Can block."*
- `ToolCallEventResult { block?: boolean; reason?: string; terminate?: boolean }` — `types.d.ts:779-788`
- The runtime honors it: `agent-session.js:223-243` wires `agent.beforeToolCall` to `emitToolCall`, and **fails closed** — a non-Error throw becomes `"Extension failed, blocking execution"`.

**langy does not use it.** `services/langyworker/src/` registers only `before_agent_start`, `session_start`, `session_tree` — no `"tool_call"` handler anywhere in the tree. The Go-side wire protocol likewise carries only post-hoc `tool_start`/`tool_end`.

So the capability to gate deletes deterministically exists, ships today, and is simply unwired.

### What was checked (still valid)

- **CLI** — the only confirm among 15 delete commands is `tag delete`'s type-to-confirm (`sdks/typescript/src/cli/commands/tag/delete.ts:7-40`). It has **no TTY check** and is **fully bypassed by `--force`** (`program.ts:1163`). The other 14 have no prompt at all, and a prompt is meaningless when Langy drives the CLI non-interactively.
- **Server** — every delete gates on **RBAC scope only** (dashboard `dashboards.ts:81-93` `analytics:delete`; evaluator `evaluators.ts:298-306` `evaluations:manage`), using the **same long-lived API key**. No confirm/token/nonce field in any delete Zod schema.
- **Go layer** — still spawns a subprocess (`langy-worker` over stdio JSONL instead of opencode over HTTP); `exec.Command*` remains only at `adapters/runner/localunsafe/localunsafe.go:55` and `adapters/runner/sandboxed/sandboxed.go:47`. The veto point is **inside the worker**, not in Go.

### Gate shape, and its one real wrinkle

There is **no product-level `delete` tool**. Langy's tools are the SDK built-ins (`read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`, `session.ts:32-41`) plus two langy-owned ones (`todowrite`, `skill`). Deletes therefore ride **generic `bash`** running the langwatch CLI. A gate is a `tool_call` handler matching delete verbs in `event.input.command` and returning `{ block: true, reason: ... }` unless the turn carries a genuine user confirmation.

That means the gate's precision depends on **command-string matching** — a maintenance surface that must fail closed (block on ambiguity) and be pinned by tests. That is ordinary engineering, not a one-way door.

*Caveat, stated plainly:* the handler runs in the worker process, and Langy holds `edit`/`write`. It cannot rewrite the already-loaded module of its running session or the deployed artifact, but the gate should be treated as defense against a confused/manipulated agent, not against a fully adversarial one with repo write access.

### The two options from the ORIGINAL finding (now fallbacks, not the primary path)

### The two real options (a one-way platform decision — NOT made here)

1. **Out-of-band confirm token.** Server mints a short-lived nonce surfaced only in the web UI (or via Slack/email). The human relays it back through the CLI. Langy cannot fabricate it. Cost: new token infra + a delete-side schema field on every delete route.
2. **Credential scoping.** Langy's API key is scoped *without* delete/manage permission; deletes require a separate human-only credential. Removes the capability entirely rather than gating it. Cost: permission-model change + operational split of who holds which key. No new token infra.

### Recommendation for owners (REVISED)

**Wire the `tool_call` handler.** It is an in-repo change in `services/langyworker/`, deterministic and testable, and needs no platform decision, no token infra, and no permission-model split. The two options below remain available as *additional* depth if owners want a guarantee that survives an agent with repo write access.

Of those two, prefer **(2) credential scoping** if the product can tolerate "Langy proposes, a human executes the delete" — it's the strongest guarantee (capability removed, not gated) and needs no new token machinery. Choose **(1)** only if Langy must be able to complete deletes itself within a session.

### What is being built in-repo now (correct under either option)

Hardening the behavioral layer: AGENTS.md delete policy + the e2e rubrics grade "confirm first, on every delete, no self-authored/replayed passphrase." This is honest about being **probabilistic** (an LLM-judge on transcripts, not a code gate) — it reduces the failure rate observed in #7562 but does not structurally guarantee it. Under the pi harness the structural guarantee is now an ordinary code change (the `tool_call` handler above), **not** a platform decision — the prompt/rubric work remains correct and complementary, but it is no longer the ceiling.
