# ADR-033: Coding-agent cost intelligence via ingest-time content-block classification with cache-aware exact-token cost attribution

**Date:** 2026-07-02

**Status:** Accepted

> One-line: classify every **content block** of coding-agent CLI traffic at **ingest-time enrichment** into a **12-category taxonomy**, attribute cost per category by **tokenizing blocks and scaling to provider-reported truth with cache-aware pricing**, accumulate into the **existing trace/session folds**, and surface it in the **existing governance dashboards** — analytics only, never billing.

## Context

### Forces

- **Competitive window.** As part of competitive research, an unreleased competitor tool was found that categorizes coding-agent API cost by content type (system prompt / MCP / skills / tools / memory) via a local MITM proxy. Its cost split is **byte-proportional** — no tokenizer involved anywhere. Full research evidence lives in the internal research vault. Shipping the same insight computed from **real token usage** before or at their launch is the differentiation play.
- **We already hold better raw material than a proxy can get.** The CLI wrapper (`langwatch claude|codex|…`) captures full request/response JSON via the gateway path (`services/aigateway/app/pipeline/trace.go:47-131`) and via Claude Code's `OTEL_LOG_RAW_API_BODIES` OTel path (`typescript-sdk/src/cli/utils/governance/wrapper-mode.ts:382-420`). Codex sessions are reconstructed from rollout transcripts (`codex-rollout.ts`). Real per-span token usage (`gen_ai.usage.*`) and canonicalized `gen_ai.request.reasoning_effort` already flow through the pipeline.
- **The gap is classification, not capture.** Today `spanAttributes` are stored opaque; no stage distinguishes a system prompt from an MCP tool definition from a skill invocation. Cost is span-level only.

### Constraints (locked in framing)

1. **No new parallel infrastructure.** Extend the event-sourcing pipeline (enrichment in `recordSpanCommand.ts`, fold projections) and existing dashboards. ADR-018 is house law: the last parallel pipeline was torn out at cost.
2. **Exact tokens, never byte-estimates.** Per-category cost derives from real tokenization scaled to provider-reported usage — never the byte-proportional guess seen in research. This is the headline claim; it is non-negotiable.
3. **No new ClickHouse table.** Category data lives on `stored_spans` attributes and existing fold-projection summaries.
4. **Analytics only — never billing.** Category numbers are display/insight values. They MUST NOT feed billing, quotas, budget enforcement, or plan limits (see Invariants).

### Prior ADRs this builds on

- **ADR-017** (gateway payload capture): content presence is opt-in per virtual key (`none|metadata_only|redacted|raw`). Classification is only possible when content is present; this ADR does not change any capture default.
- **ADR-018** (unified observability substrate): one ingestion path, one trace store. The v1 CLI-only scope below is implemented as a content predicate, not a source-type pipeline branch (see Decision 6).
- **ADR-015** (projection replay): classification is deterministic and versioned so improved heuristics can be replayed onto history.
- **ADR-021** (lean fold cache): new fold fields must respect fold-size pressure; per-category totals are bounded (≤18 keys), per-block detail stays on spans, not in folds.

## Decision

1. **Classification runs at ingest-time enrichment.** A new pure-synchronous step in the `recordSpanCommand.ts` enrichment chain — **serial, after** the parallel `Promise.allSettled` block (PII redaction, cost enrichment, token estimation) because it consumes their outputs (per-tier rates `langwatch.model.*`, tokenizer), and before content drop and attribute cap. Why: categories are stamped once, flow into folds and ClickHouse, are queryable and indexable forever, and replay via ADR-015. Cost honesty: this is not a free string match — it tokenizes every content block (N per-block tokenizer calls, real CPU on an 8 MiB body), which is why the hot-path invariant carries an explicit block cap and a perf test, not a hand-wave. Rejects read-time classification (re-scans millions of span rows per dashboard load — the exact heavy-column pattern `clickhouse-queries.md` bans) and an async reactor (2× event volume and eventual-consistency lag for a bounded synchronous CPU task).
   - Ordering note: classification runs on the span content **after** PII redaction. Redaction replaces entity values but preserves message/block structure, and all detectors match structure and stable markers (roles, block types, tool-name prefixes, tag openers), never PII-bearing values — so redaction does not change classification results.

2. **Cost attribution is cache-aware exact-token allocation.** For each span with content:
   1. Tokenize every content block with the existing tokenizer infrastructure (`OtlpSpanTokenEstimationService`).
   2. Partition provider-reported usage as ground truth: `input_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`, `output_tokens` are never overridden.
   3. Assign blocks to **all three** input cache tiers by prefix position on Anthropic requests: blocks up to the last `cache_control` breakpoint are attributed first to the cache-read pool (up to `cache_read_input_tokens`), then overflow to the cache-creation pool (up to `cache_creation_input_tokens`) — this covers turn 1, where `cache_read = 0` and the entire prefix is cache-creation at 1.25× price; blocks after the last breakpoint go to the fresh-input pool. Every provider-reported pool with nonzero tokens MUST receive block assignments; a pool left empty of blocks (e.g., truncated content) allocates its full total to the axis catch-all so conservation holds.
   4. Within each pool, scale block token estimates so per-category tokens sum exactly to that pool's provider-reported total: `category_tokens = block_tokens × (pool_total / Σ pool_block_tokens)`. Zero-guard: when `Σ pool_block_tokens = 0` for a nonzero pool (content absent, truncated, or reconstructed), the pool's entire total lands in `other_input`/`other_output` — never dropped, never divided by zero.
   5. Price each category's tokens with the per-tier rates already stamped by cost enrichment (`langwatch.model.inputCostPerToken`, `cacheReadCostPerToken`, `cacheCreationCostPerToken`, etc.).
   
   Breakpoint-fidelity caveat (recorded, not hidden): the gateway captures the request body **after** its own cache-control middleware may have rewritten it (org override `disable` strips all `cache_control`; `force` injects one at the tail — `services/aigateway` chain order Cache → Trace-last), and the Claude OTel raw-bodies path truncates inline bodies at ~60 KB, which can drop trailing blocks and the last breakpoint. Tier assignment therefore reads *effective* breakpoints (what was actually sent upstream — which is the correct basis for what was billed), and degraded capture degrades to the zero-guard path, never to wrong-but-confident numbers.
   
   Why cache-aware and not flat: a cached system prompt bills at ~0.1× on cache reads — a flat split reports the system prompt as the most expensive lane when it is nearly free after turn 1. This inverts the top recommendation a customer would draw from the chart. Rejects flat token-split (materially misleading $ per category) and provider-axes-only split (exact but answers none of the "what do MCP defs cost me" questions the feature exists for).

3. **Taxonomy: 12 primary categories on two axes, plus catch-alls, extensible additively.**
   - Input axis: `system_prompt`, `user_input`, `prior_context`, `tool_result_builtin`, `tool_result_mcp`, `tool_definitions`, `mcp_tool_definitions`, `skill_content`, `memory_context`, `file_attachment`, `image`, `other_input`.
   - Output axis: `assistant_text`, `tool_call_builtin`, `tool_call_mcp`, `skill_invocation`, `thinking`, `other_output`.
   - Detectors are pure structural/marker heuristics (block `type`, role, `mcp__` tool-name prefix, `<system-reminder>`/`<mcp-instructions>` openers, skill-content markers) — no regex engines, no LLM, no network. `leadingContext.ts` (`splitLeadingContextBlocks`) is the **seed heuristic**, not a move: it splits leading XML off a single string for UI rendering, while the classifier needs structured 12-way classification over block arrays. The marker set is extracted into a shared pure module consumed by both the server classifier and the existing UI callers (no server→client import, no duplicated marker lists).
   - Rejects copying the researched tool's 23 categories verbatim (half are Claude-Code-internal artifacts that won't aggregate meaningfully) and a minimal-6 taxonomy (visibly poorer than the competing product; splitting later forces reclassifying history).

4. **Storage: per-block detail on span attributes; aggregates in existing folds.**
   - Span: `langwatch.reserved.blocks.classification` — bounded array of `{idx, category, tokens, cacheTier}` — plus `langwatch.reserved.blocks.classifier_version`. The `langwatch.reserved.*` prefix is mandatory, not stylistic: it is the only namespace `stripReservedAttributes` scrubs from customer-supplied SDK spans (`recordSpanCommand.ts` `RESERVED_PREFIX`), so system-computed classifications cannot be spoofed by ingested attributes — the same protection `langwatch.reserved.cache_read_tokens` already relies on. Rides existing `stored_spans` storage; subject to the existing attribute cap.
   - Trace: `TraceSummaryFoldProjection` extended with `categoryTotals: Record<Category, {tokens, costUsd}>` following the exact pattern of today's token/cost accumulation (`traceSummary.foldProjection.ts:154-195`).
   - Session: a session-level fold keyed by the captured session id (Claude: `X-Claude-Code-Session-Id`; Codex: the rollout session id from the transcript metadata — `prompt_cache_key` is the gateway-path convention only and is observed `null` on real traffic, so it is not the v1 transcript-path key) accumulating step/turn counts, per-step input-token sizes, `compactionEvents`, and per-category totals.
   - Rejects span-attrs-only (query-time scans) and fold-only (loses drill-down and the audit trail for any classification dispute).

5. **Turn and compaction tracking ships in v1 — defined on steps ordered by start time, detected against the running maximum.** Precision matters here because the naive version is noise:
   - A **step** is one LLM API span. Steps within a session are ordered by span **start time**, never by arrival order (OTLP delivery is unordered and retried).
   - One conversational **turn** spans multiple steps (tool loops), and Claude Code subagents interleave small steps under the same session id. So consecutive-step comparison is unsound: a small subagent step after a big main-thread step is a >40% drop that means nothing.
   - A **compaction event** is therefore detected against the session's **running maximum** input size, with confirmation: a step whose input tokens fall below `(1 − COMPACTION_DROP_RATIO) × runningMax`, followed by `COMPACTION_CONFIRMATION_STEPS` further steps that stay below the old max (i.e., the session genuinely re-based, it wasn't one small parallel request). Only then does the running max reset. Small subagent steps never reset the max, so they cannot fire events.
   
   This powers the context-growth chart and, later, the `/compact` recommendation — the recommendation itself is deferred (Decision 8), the data is not, because retrofitting session folds later would orphan all v1 history.

6. **v1 scope is coding-agent CLI traffic, both harnesses (Claude Code and Codex).** User decision, recorded with its tension: this narrows blast radius and matches the competitive story, but resembles the source-branching ADR-018 removed. Reconciliation: there is **one** classifier in **one** pipeline; scope is enforced by a harness-detection predicate on already-captured evidence (session-id header presence, wrapper-stamped attributes, user-agent), not by a separate ingestion path. Extending to generic traffic later means widening the predicate, not building anything. Codex caveat, accepted explicitly: its input is transcript-reconstructed rather than raw wire JSON, some fields are lossy, and cache-tier modeling is weaker on the OpenAI shape — v1 ships it anyway (user override of the phased recommendation).

7. **Content-availability policy: skip silently, change no capture defaults.** Content present (CLI OTel raw-bodies path, or gateway VK with `capture_payload ≥ redacted`) → classify. Content absent → span skipped without error, fold `categoryTotals` stays empty, dashboard renders an empty-state pointing at payload capture settings. ADR-017's privacy defaults are untouched. Rejects a `metadata_only` coarse fallback (mixing 3-lane and 12-lane traces in one aggregate produces apples-plus-oranges totals).

8. **Recommendations are deferred entirely from v1.** v1 ships the numbers (breakdown lanes, session insights); the savings-recommendation cards ("drop xhigh→high", "tighten /compact", "fewer MCPs") ship as v1.1 once real category distributions exist to calibrate thresholds against. User decision: no unvalidated savings claims in the first release.

9. **UI: extend the existing governance dashboards.** `/me` personal usage gains category-breakdown lanes; the org Activity Monitor gains the per-harness breakdown and session insights. RBAC (`activityMonitor:view`), plan-gating, and ingestion-source filters are reused as-is — **gating follows the host page**, no new `PLAN_LIMITS` entries. Rejects a new top-level "Cost Intelligence" surface (duplicates existing spend views; new nav + RBAC for no v1 gain) and trace-drawer-first (no org-level story).

## Constants

| Name | Value | Purpose |
|---|---|---|
| `CATEGORY_ENUM` | 18 values (12 input-axis + 6 output-axis incl. catch-alls), exact strings in Decision 3 | Fold keys, span attribute values, dashboard lanes. Additive growth only; never rename a shipped value. |
| `SPAN_ATTR_BLOCKS` | `langwatch.reserved.blocks.classification` | Per-block detail attribute on spans. `reserved` prefix required — spoof protection via `stripReservedAttributes`. |
| `SPAN_ATTR_CLASSIFIER_VERSION` | `langwatch.reserved.blocks.classifier_version` (integer, starts at `1`) | Replay/audit: which heuristic set produced these categories. |
| `COMPACTION_DROP_RATIO` | `0.4` (step input tokens < 60% of session running max) | Compaction-event detection threshold. Tunable constant, not org-configurable in v1. |
| `COMPACTION_CONFIRMATION_STEPS` | `2` (subsequent steps that must stay below the old max before the event is confirmed and the running max resets) | Filters false positives from small subagent/parallel steps. |
| `MAX_CLASSIFIED_BLOCKS_PER_SPAN` | `512` | Hard bound on detail-array size; overflow blocks aggregate into the axis catch-all so category **totals stay complete** even when per-block detail is truncated. |
| `MCP_TOOL_PREFIX` | `mcp__` | Built-in vs MCP discrimination on tool names (Claude Code wire convention). |
| Allocation formula | `category_tokens = Σ block_tokens × (pool_total / Σ pool_block_tokens)` per cache-tier pool | Guarantees per-category tokens sum exactly to provider-reported usage. |

## Invariants

| Invariant | Meaning | Satisfied by / test anchor |
|---|---|---|
| **Conservation of cost** | Σ per-category cost per span ≡ span-level real cost (within float rounding); never more, never less. | Scaling step (Decision 2.4). Unit test: property-based over random block sets and usage totals. |
| **Never feeds billing** | No billing, quota, budget-enforcement, or plan-limit code path reads `categoryTotals` or block classifications. | Code review gate + integration test asserting billing services have no import path into the classifier's outputs. |
| **Ingestion never fails on classification** | Classifier throw/timeout → span stored without categories; pipeline continues. | Serial step wrapped in its own try/catch (same failure posture as the `Promise.allSettled` enrichment block it follows). Test: malformed content block → span persists, no categories, no error surfaced. |
| **Hot-path bounded** | Pure sync CPU; no network, no LLM, no unbounded loops; block count capped. | `MAX_CLASSIFIED_BLOCKS_PER_SPAN`; detectors are O(blocks × markers). Perf test on a 8 MiB-body span. |
| **Deterministic + versioned** | Same span content + same classifier version → identical output, replayable per ADR-015. | No randomness, no clock reads in detectors; version stamped per span. |
| **Absent content is silent** | `capture_payload = none/metadata_only` or missing bodies → no categories, no errors, honest empty-state. | Decision 7. Integration test per capture level. |
| **Tenant isolation** | Any new CH read filters `TenantId` first (house rule). | Existing query review gate; applies to new dashboard queries only (no new tables). |

## Schema

No database migrations. All changes are within existing structures:

```ts
// Span attributes (stored_spans, existing table — new reserved keys;
// reserved prefix = scrubbed from customer SDK input by stripReservedAttributes)
"langwatch.reserved.blocks.classification": Array<{
  idx: number;            // sequential content-part index within the axis walk (input parts and output parts counted separately)
  category: Category;     // CATEGORY_ENUM value
  tokens: number;         // scaled, post-allocation (Decision 2.4)
  cacheTier: "fresh" | "cache_read" | "cache_creation";
}>;
"langwatch.reserved.blocks.classifier_version": number;

// TraceSummary fold (existing projection — new field)
categoryTotals?: Partial<Record<Category, { tokens: number; costUsd: number }>>;

// Session view (v3: NOT a session-keyed fold — see Revisions v3). Realised as
// a bounded per-trace step series on the trace summary + a pure read-time rollup.
//
// (a) Per-trace step series — bounded reserved attribute on the TRACE summary,
//     appended by the trace fold for each coding-agent LLM step (span path and
//     Path B log turns). `inputTokens` is the step's TOTAL input context
//     (fresh + cache-read + cache-creation), the only signal that reflects
//     genuine context re-basing (a cached turn's fresh input is tiny).
"langwatch.reserved.session_steps": Array<{ startMs: number; inputTokens: number }>;
                                   // ordered by span startTime; bounded: past 512 entries,
                                   // adjacent pairs merge (keep max) — halves resolution,
                                   // preserves the sawtooth shape and ADR-021 limits
"langwatch.reserved.session.harness": "claude" | "codex";

// (b) Read-time rollup (sessionRollup.service.ts) over lean trace SUMMARIES,
//     grouped by (harness, threadId). threadId reads langwatch.thread.id
//     (log path) or gen_ai.conversation.id (span path). Claude sessions live in
//     one summary; Codex's are fragmented across traces and re-joined here.
type SessionView = {
  harness: "claude" | "codex";
  threadId: string;                // claude: session id | codex: rollout/conversation id
  stepCount: number;               // LLM API steps across the session's traces
  steps: Array<{ startMs; inputTokens }>; // concatenated, sorted by startMs
  runningMaxInputTokens: number;   // compaction baseline (Decision 5)
  compactionEvents: number;        // detectCompactionEvents(): running-max + confirmation
  categoryTotals: Partial<Record<Category, { tokens: number; costUsd: number }>>;
};
```

## Rejected alternatives

- **Read-time classification** — re-classifies millions of spans per dashboard load; unindexable in CH.
- **Async reactor classification** — 2× event volume and dashboard lag for a microseconds CPU task.
- **Byte-proportional cost split (the researched competitor's method)** — violates the exact-tokens constraint; ±15–30% error on code/JSON-heavy content.
- **Provider-axes-only split** — exact but cannot answer any per-category question; kills the feature's premise.
- **Flat (non-cache-aware) token split** — systematically overstates cached-prefix categories (system prompt, tool defs); misleading enough to invert conclusions.
- **The researched 23-category taxonomy verbatim** — half the categories are Claude-Code-internal artifacts with no aggregate meaning.
- **Minimal 6-category taxonomy** — visibly poorer than the competing product; later splits force history reclassification.
- **Classify all traffic in v1** — rejected by user for blast radius and focus; revisit as predicate-widening (Decision 6), not new build.
- **Claude-first, Codex fast-follow** — rejected by user; complete CLI story at launch outweighs the halved v1 surface.
- **`metadata_only` coarse fallback** — mixes 3-lane and 12-lane traces into incoherent totals.
- **Changing capture defaults for the feature** — privacy posture (ADR-017) outranks feature light-up rate.
- **Recommendations in v1 / full rules engine** — deferred by user; no savings claims before real distributions exist; a rules DSL for three known rules is premature abstraction.
- **New "Cost Intelligence" nav surface** — duplicates existing spend views; no v1 gain over extending governance pages.
- **New ClickHouse table** — excluded by constraint; own retention/merge lifecycle for data that fits existing structures.

## Consequences

**Positive**
- Category cost numbers are allocation-of-truth: totals always equal the real bill, split at tokenizer-grade accuracy (~±1–3% on text) vs the competitor's byte-share guess — the marketing claim is technically honest.
- Everything rides hardened infrastructure: event-sourcing enrichment, fold projections, replay, RBAC, plan-gating, retention. Zero new operational surface.
- Session folds from day one mean v1.1 recommendations launch with full history behind them.

**Negative**
- v1 is the widest locked scope: cache-aware modeling **and** both harnesses **and** session tracking before first ship. No phasing valve was kept except recommendations.
- Cache-tier assignment (Decision 2.3) is a model, not a measurement — Anthropic does not report which blocks were cache-hits. Prefix-position inference is right in the common case (stable prefix, breakpoints after tool defs) and degrades when customers move breakpoints mid-session. The per-tier *totals* remain exact; only the within-tier categorical assignment carries model error.
- Capture fidelity is **not uniform across paths**, and the design must not pretend it is: the gateway body is post-middleware (rewritten `cache_control` under org overrides), and the Claude OTel raw-bodies path truncates at ~60 KB inline. Both degrade to the zero-guard/catch-all path (Decision 2.4), never to silently wrong splits.
- The per-block tokenizer is OpenAI BPE (`TiktokenClient` default) applied to Anthropic content — pool totals stay exact via scaling, but the *within-tier* categorical split inherits cross-tokenizer error; "±1–3%" is the text-content best case, not a guarantee on code/JSON-heavy blocks.
- Codex numbers are second-class: transcript-reconstructed input, lossy fields, weaker cache modeling on the OpenAI shape. The dashboard must not visually imply equal fidelity across harnesses.
- Dashboards are empty for gateway VKs with `capture_payload = none` (the ADR-017 default) — the feature's reach is bounded by payload-capture opt-in.
- CLI-only predicate is acknowledged debt against ADR-018's spirit; mitigated by single-pipeline design, but it exists.

**Neutral**
- Classifier version stamping makes heuristic improvements a replay decision (ADR-015), not a redesign.
- `/me` vs Activity Monitor availability differences are inherited, not designed here.

## Open questions

| Question | Owner | Blocking? |
|---|---|---|
| v1.1 recommendation thresholds — calibrate from real category distributions after v1 ships. | product + data review after v1 | No |
| Generic (non-CLI) traffic extension — when to widen the harness predicate. | revisit post-v1 adoption data | No |
| Historical backfill — replay classifier over pre-v1 history, or forward-only? Replay cost vs dashboard continuity. | eng, at implementation time | No (forward-only is the safe default) |
| Gemini / OpenCode harness detectors. | v1.2+ | No |

## Revisions

- **v1 (2026-07-02)** — Initial draft. Framing round locked: full-feature scope, competitive-window forcing function, analytics-only blast radius, constraints (no parallel infra / exact tokens / no new CH table). Fork round 1 locked: ingest-time enrichment; cache-aware token split (user escalated from flat split); 12-category two-axis taxonomy; CLI-only v1 scope (user override of classify-everything recommendation). Fork round 2 locked: span-attrs + fold storage; full turn/compaction tracking in v1; recommendations deferred entirely (user override of 3-template-rules recommendation); extend governance dashboards. Fork round 3 locked: skip-silently content policy; both harnesses in v1 (user override of Claude-first phasing); gating follows host pages.
- **v3 (2026-07-03)** — Implementation revision (PR C): Decision 4's "session-level fold" is realised as per-trace step series in the existing trace fold + a pure read-time session rollup over lean trace summaries grouped by thread id, NOT a session-keyed fold projection. The fold framework keys strictly by traceId; a session-keyed fold would need a second event per span (rejected in Decision 1) or a new aggregate pipeline. For Claude Code, turns already fold into one summary (trace ≈ session); the rollup only merges Codex's fragmented traces. Rollup input is trace SUMMARIES (lean rows), not stored spans — the read-time pattern rejected in Decision 1 concerned span scans, which this does not do.
- **v2 (2026-07-03)** — Red-team pass (devils-advocate), 9 findings folded in; no locked fork reopened. Blockers fixed: (1) three-tier cache binning — v1's two-tier rule left `cache_creation` blocks unassigned, breaking conservation-of-cost on every session's first turn; (2) attribute namespace moved to `langwatch.reserved.blocks.*` — the bare `langwatch.blocks.*` prefix was customer-spoofable because only `reserved.*` is scrubbed at ingest. Must-fixes: classification declared serial-after-enrichment (it consumes cost/tokenizer outputs; v1 wrongly implied parallel) and its per-block tokenization cost stated honestly; breakpoint-fidelity caveat added (gateway captures post-middleware bodies; OTel path truncates at ~60 KB); turn/compaction redefined on start-time-ordered steps against a running max with confirmation steps (consecutive-step comparison false-fires on subagent interleaving); Codex session key corrected to rollout transcript id (`prompt_cache_key` is gateway-only and observed null). Notes: `leadingContext.ts` reframed as seed heuristic extracted to a shared module (not a "move"); tiktoken-on-Anthropic split error acknowledged in Consequences; `Σ pool_block_tokens = 0` zero-guard specified (pool total → axis catch-all).
