# Plan: Claude Code telemetry — real spans + log enrichment (retire synthesis)

Status: **plan approved for build** · Owner: Alex · Related: PR #5708 (beta flag), this branch.

## 0. The shape (decided)

Claude Code, with the enhanced-telemetry beta on, emits **real OTLP spans** carrying
`agent_id`/`parent_agent_id`/`request_id`/tokens/cost/`gen_ai.*` — but **no message
content**. Content lives only in log records (`api_request_body`,
`api_response_body`, `user_prompt`, `assistant_response`). We ingest the real spans
and attach content from the logs. We do **not** synthesize spans (that reactor is
retired behind a gate). Full rationale — why not a write-time fold, why not
synthesize-at-ingest — in §7.

Two content surfaces, **different consumers, different mechanisms** (per the
directive):

| Consumer | Path | Content mechanism |
|---|---|---|
| **Legacy** — REST trace API (`app/api/traces`), **export** (`app/api/export/traces`), legacy tRPC (`traces.ts`/`spans.ts`), **evals** | `TraceService` (`server/traces/trace.service.ts`) | **backend auto-enrich** — join capped content onto spans server-side so nothing breaks |
| **Dashboard** — new UI | `tracesV2.ts` → `SpanStorageService.getSpansByTraceId` | **frontend join** — UI fetches spans + logs separately and composes |
| **Raw inspector** (any) | new logs read API | lazy fetch of untruncated bodies |
| **Trace headline** (list, search) | `traceSummary.foldProjection` | already lifts IO from logs; verify + adjust under the new mix |

Why the split: exports/evals/legacy read `Span.input/output` and would break if the
join were frontend-only, so those get server-side capped enrichment. The dashboard
is new and can compose client-side, keeping its span payload light and the heavy
bodies out of the hot path.

## 1. Problem (verified in prod)

- **Sub-agent collapse:** synthesis keys `traceId = sha256(session:prompt)`; sub-agents share the parent's `session.id`+`prompt.id` → one turn-trace with 1285 spans / 66 min (`6c72bc76…`), ~95% sub-agent internals.
- **Double-count:** traces-enabled clients store real `claude_code.*` spans AND synthesized `…events` spans — same call twice, in two traces. Live in `0f15aea5…`.
- **Order-fragile join:** the synthesis fold pairs bodies to anchors by `(model,query_source)` consume-once because the body log has no `request_id`.

The beta flag (shipped: PR #5708 + SDK) makes the real spans available; the content
still needs joining from logs.

## 2. Signals

| Signal | Event | Carries | Weight |
|---|---|---|---|
| trace | `llm_request` span | model, tokens, cost, `agent_id`, `parent_agent_id`, `request_id`, `gen_ai.*` — **no content** | light |
| trace | `tool` span + `tool.output` event | tool I/O content | light–med |
| log | `api_request_body` | **input** JSON (START, **no request_id**, parent-interaction SpanId, capped 60 KB) | heavy |
| log | `api_response_body` | **output** JSON (**has request_id**) | heavy |
| log | `user_prompt` | clean user turn input | light |
| log | `api_request` / `tool_decision` / `tool_result` | structural — **duplicated by real spans** | light |

**Join key:** output → `request_id` (exact). Input → positional: zip `api_request_body`↔`api_response_body` by `event.timestamp` within a `query_source`, then the response's `request_id` → span. Residual gap: concurrent same-`query_source` sub-agents (upstream ask: stamp `request_id` on `api_request_body`).

### 2.1 Collect less — drop the redundant request body (decision)

`api_request_body` carries the **entire rolling message history** every turn (turn N
re-sends 1…N-1) — an O(n)×60 KB redundant class. It is **not needed**: the
conversation is reconstructable from the per-turn logs, tool outputs ride the
`tool.output` span event, and `tool_use` is on the real `claude_code.tool` spans.
Its only unique content is the (near-static) system prompt + tool schemas.

**Target collection for enhanced-telemetry projects:**
`OTEL_LOG_USER_PROMPTS=1` + `OTEL_LOG_ASSISTANT_RESPONSES=1` + `OTEL_LOG_TOOL_CONTENT=1`,
and **`OTEL_LOG_RAW_API_BODIES=0`** — drop the heavy bodies at the source.
- **Output** ← `assistant_response` (text, **carries `request_id`** → exact span join).
- **Input** ← `user_prompt` (main thread) / the `Agent` spawn task prompt (sub-agent).
- **Tool I/O** ← `tool.output` span event.

Gives up: exact per-call system prompt / tool schemas (static — capture once per
session only if ever needed), exact message framing. Thinking is redacted by Claude
from raw bodies regardless. This removes the request↔response positional pairing
entirely (both joins become exact `request_id`), which also closes the
concurrent-same-type-sub-agent gap for **output**.

Caveat: this changes the **shipped SDK default** (currently `RAW_API_BODIES=1`);
confirm `assistant_response` completeness in prod before flipping the global
snippet. The design below is written against the light events; the request-body
path stays only as the pre-flip / non-beta fallback.

## 3. Implementation components

### C0 — Per-project enhanced-telemetry gate + retention flip *(prereq; fixes the live double-count)*
- **Reactor** on `span_received`, gated `scopeName === "com.anthropic.claude_code.tracing"`, deduped per project (`makeJobId: cc-enhanced:${tenantId}`, `runIn:["worker"]`, mirror `projectMetadata.reactor.ts`). On first sight sets a project flag (`project.claudeCodeEnhancedTelemetry = true`).
- **Ingest** (`log-request-collection.service.ts`, at the `claudeCodeLogKind` marking site ~L166): when the project flag is set, **stop stamping `CLAUDE_CODE_KIND_ATTR`** on content logs. Effects: (a) `claudeCodeSpanSync` finds nothing to fold → no synthetic spans → double-count gone; (b) content logs fall through to **normal project retention** automatically (they're no longer stamped with `CLAUDE_CODE_LOG_RETENTION_DAYS=1`).
- Gate can't be per-trace (synthesized vs real traceId are different traces). Latency: a brand-new project may briefly double-count until the reactor flips the flag — bounded, self-healing.
- Files: new `reactors/claudeCodeEnhancedTelemetryGate.reactor.ts` + `pipeline.ts` registration; `log-request-collection.service.ts` (read flag); Prisma `Project` flag column + migration.
- Tests: reactor sets flag on tracing scope only; ingest skips marking when flag set (→ no synth, normal retention) and still marks when unset (fallback).

### C1 — Logs read API *(dashboard frontend join + raw inspector)*
- **Repository** `getClaudeContentLogsByTrace(tenantId, traceId, occurredAtMs?)` → `StoredLogRecordRow[]` for `event.name ∈ {api_request_body, api_response_body, user_prompt, assistant_response}` under the claude scope. Mirror `getMarkedClaudeCodeLogsByTrace`'s partition-key time-cap + IN-tuple dedup; **not** filtered on `CLAUDE_CODE_KIND_ATTR` (post-gate they're unmarked); origin-gated + lazy.
- **Service** `LogRecordStorageService.getContentLogsByTraceId`.
- **tRPC** `tracesV2.claudeContentLogs` (protectedProcedure, input `{projectId, traceId}`) returning the logs (body included) for the frontend.
- Files: `repositories/log-record-storage.repository.ts` (+ CH + Null impls), `log-record-storage.service.ts`, `api/routers/tracesV2.ts`.
- Tests: repo returns content logs for a trace, time-capped; excludes non-claude; unit for the service.

### C2 — Backend enrichment on legacy `TraceService` *(exports/REST/legacy/evals)*
- **Pure fn** `enrichSpansWithClaudeLogContent({ spans, logs }): Span[]` in a new `claude-code-span-enrichment.ts`, **capped** via `capPayloadString`, idempotent, no-op for non-claude spans. Two content paths:
  - **Light (target, §2.1):** output ← `assistant_response.body` joined by `request_id` (exact); input ← `user_prompt.prompt` for the turn (main thread) / the `Agent` spawn task prompt (sub-agent).
  - **Body fallback (pre-flip / non-beta):** output ← `api_response_body` by `request_id`; input ← `api_request_body` positional, reusing `buildInputMessagesFromRequestBody`/`extractAssistantOutputFromResponseBody` (no re-implementation).
- **Wire** into `TraceService.getById` (L206) — fetch content logs (C1 service) when the trace is coding-agent origin, join, return enriched spans. Capped content only (raw stays in logs).
- Files: `server/app-layer/traces/claude-code-span-enrichment.ts` (+ unit test), `server/traces/trace.service.ts`.
- Tests: unit on the pure fn with the §8 fixtures (output request_id join; input positional; capping; non-claude no-op); integration that `TraceService.getById` returns enriched spans; **export** smoke (claude trace exports with populated input/output).

### C3 — Dashboard frontend join *(tracesV2 UI)*
- `tracesV2` stays content-free on spans. The traces-v2 feature fetches spans (existing) + `claudeContentLogs` (C1) and composes in the drawer/waterfall. Raw bodies shown via the same logs API on demand.
- Files: `features/traces-v2/**` (drawer/waterfall + a hook `useClaudeContentLogs`).
- Tests: integration render — drawer shows joined input/output for a claude trace from mocked spans+logs.

### C4 — Trace-summary fold under the new mix *(headline IO + cost)*
- `extractIOFromLogRecord` already lifts input (`user_prompt`) + output (`repl_main_thread` `api_response_body`), and `CONVERSATIONAL_QUERY_SOURCES={repl_main_thread}` already excludes sub-agent/utility output. **Verify** it works when content logs land under the **real** traceId alongside real spans (post-gate), and that **cost/tokens now derive from the real `llm_request` spans** (synthesized spans gone → no summary double-count either).
- Watch: one real traceId can hold 600+ spans (native tracer groups a session); `MAX_PROCESSED_SPANS=512` may under-count huge claude traces — decide whether to raise/skip for this scope.
- Files: `projections/services/trace-io-accumulation.service.ts` (adjust only if a gap is found), `traceSummary.foldProjection.ts`.
- Tests: fold a real-span + content-log event stream (no synthesized spans) → summary has correct headline input/output + single-counted cost; sub-agent response doesn't win the headline.

### C5 — Retire synthesis *(gated)*
- Keep `claudeCodeSpanSync.reactor.ts` + `convertClaudeCodeTurnToSpans` as the **logs-only fallback** (runs only when the project flag is off). Delete once the beta snippet is default + adoption confirmed (removes the reactor, converter, and `getMarkedClaudeCodeLogsByTrace`).

### Deferred escape hatch
Only if per-span content ever must be **searchable in ClickHouse**: a reactor
re-dispatching `recordSpan` for the **real SpanId** with capped `gen_ai.*.messages`
(map-native RMT versioned re-write + completeness-nudge) — **not** a fold. Build on
demand; there is no per-span content search today.

## 4. Build order

1. **C0** (gate + retention) — stops the live double-count. Ship first.
2. **C4** (trace-summary verify/adjust) — headline correct under the new mix.
3. **C1** (logs read API) — foundation for C2 + C3.
4. **C2** (legacy backend enrichment) — exports/evals whole again.
5. **C3** (dashboard frontend join).
6. **C5** (retire synthesis) — once beta is default.

## 5. Why not the alternatives (kept for the record)

- **Write-time fold:** a fold keys on one value + stores one state blob per key (`foldProjection.types.ts:162-176`), can't emit N keyed rows. The join key isn't single (output by `request_id`; input has neither `request_id` nor the `llm_request` SpanId — only the parent interaction SpanId; positional pairing is cross-span). The only fold that does both is a **per-trace fold emitting N rows** → re-stores every span (+heavy bodies) per event → **O(n²)** = the documented hot-trace fold-amplification incident (`traceSummary.foldProjection.ts:89`, "730 re-folds in 2h"). Rejected.
- **Synthesize-at-ingest (before `recordLog`):** cross-batch split (input START in an earlier batch than the END anchor), stateless receiver ("only appends, no cross-batch state"), no `request_id` on input → orphan half-spans. Moot under the beta (the real span already exists). Rejected.

## 6. Sub-agent tree
Render subtrees by `agent_id`/`parent_agent_id` on the real spans; re-keying into
linked child traces (`ParentTraceId` + `Links`, already carried) is a later,
separable option. Independent of this plan.

## 7. Open questions / upstream asks
- **Stamp `request_id` (or `llm_request` span_id) on `api_request_body`** → exact input join, no positional heuristic; closes the concurrent-same-type-sub-agent gap.
- `MAX_PROCESSED_SPANS=512` vs 600+-span claude session traces (C4).
- Read-cost: C2 adds one time-capped, origin-gated, lazy log read per claude trace-open (same class as the existing `resolveOffloadedTraces` second pass).

## 8. Appendix — real fixtures (sanitized, from `0f15aea5…` / `65b18da7…`)

`llm_request` span (`stored_spans`):
```json
{ "SpanName":"claude_code.llm_request","ScopeName":"com.anthropic.claude_code.tracing",
  "SpanId":"30dfcbec44ac3401","ParentSpanId":"77bb432be48046f6",
  "SpanAttributes":{"langwatch.span.type":"llm","gen_ai.request.model":"claude-opus-4-8[1m]",
    "input_tokens":"12185","output_tokens":"243","cache_read_tokens":"20184",
    "request_id":"req_011CcuGBf1…","gen_ai.response.finish_reasons":"[\"end_turn\"]",
    "gen_ai.provider.name":"anthropic","ttft_ms":"4867","duration_ms":"8578"} }
```
Content logs (`stored_log_records`) — all carry the PARENT SpanId `77bb…`:
```json
{ "event_name":"api_request_body","request_id":"","query_source":"repl_main_thread",
  "body":"{\"model\":\"claude-opus-4-8\",\"messages\":[…]}","body_len":61775 }
{ "event_name":"api_response_body","request_id":"req_011CcuGBf1…","query_source":"repl_main_thread",
  "body":"{\"model\":\"claude-opus-4-8\",\"content\":[{\"type\":\"thinking\",…},{\"type\":\"text\",…}]}","body_len":2049 }
{ "event_name":"user_prompt","request_id":"","body":"<turn text>" }
```
Sub-agent tree (`llm_request` spans):
```json
{ "agent_id":"a487ec623b7238e7f","parent_agent_id":"a344a37ad0e73af48",
  "request_id":"req_011Ccm2P6oc84x5s4BxXCAZD","model":"claude-sonnet-5" }
```
