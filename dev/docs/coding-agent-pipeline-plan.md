# Build plan: coding-agent pipeline + session aggregate

Status: **plan of record** · ADR: `dev/docs/adr/056-coding-agent-pipeline-session-aggregate.md`
· Specs: `specs/coding-agent/*.feature` · Supersedes PR #5708 (branch
`feat/claude-code-enhanced-telemetry-beta`, head `f2aca082db` — the **port
source** for everything below; never rebase or force-push that branch, close
it when slice 8 lands).

This document is the implementation hand-off. It assumes ADR-056 has been
read. Facts here were verified against live telemetry and the old branch —
do not re-derive them.

## Non-negotiables carried from investigation

- **Metrics carry no trace ids** (no exemplars in OTel Rust/JS SDKs);
  `session.id` rides 100% of coding-agent datapoints. Session key values are
  identical across signals; only attribute names differ per agent.
- **Metric idempotency:** converged per-series totals, re-written
  (Replacing LWW per `(TenantId, SessionId, SeriesId)`); never increment on
  insert; read = `SUM … GROUP BY`. No SummingMergeTree over raw points.
- **Session row reads** dedup by IN-tuple `(key, max(UpdatedAt))`, never
  FINAL; always filter the partition key (`StartedAt`).
- **Preserve PR #5708's bug fixes** when porting (all have regression tests
  on the old branch): OTLP `statusCode` is a numeric enum, never compare to
  `"error"`; MCP server/tool parsed from tool *name*
  (`mcp__server__tool`), not span attrs; `isViewMode` must know `terminal`;
  Terminal tab shortcut is not `M`.
- **Codex ignores `OTEL_*` env** (needs `config.toml [otel]`); Codex
  `total` and Gemini `tool` token buckets are non-additive — never sum them.
- **No reactors** in the new pipeline: subscribers, projections, one process
  manager. Origin gating is a predicate, not a gate reactor.
- Per-repo rules that bite here: `projectId`/TenantId first in every query;
  repositories `findAll/findById`, services `getAll/getById`; no re-exports;
  no inline `import()`; focused tests over full typecheck.

## Slices (each lands green on its own)

0. **Plan docs** — this commit (ADR-056 + specs + this plan).
1. **Pipeline scaffold.** `pipelines/coding-agent-processing/`: schemas
   (session key, contribution payloads with the lifted scalar vocabulary),
   `withAggregateType("coding_agent_session")`, contribution commands
   (`contributeSpanFacts` / `contributeLogFacts` / `contributeMetricFacts`),
   registry wiring. Port `coding-agent-normalization.ts` (incl.
   `CODING_AGENT_CONTRIBUTION_KEYS`, `detectCodingAgent`,
   `liftCodingAgentLogFacts`) into this pipeline's services.
2. **Span + log contributors → session fold.** Subscribers on
   trace-processing (span facts) and log-processing (log facts) dispatching
   contributions; session fold projection (port
   `coding-agent-session.derivation.ts` — `applySpanTo…`/`applyLogTo…` —
   re-keyed to SessionId, `TraceIds` bounded array). Migrations:
   `00051_create_coding_agent_sessions.sql` (re-cut from old branch DDL:
   `ORDER BY (TenantId, StartedAt, SessionId)`, same bounded columns +
   comments) and `coding_agent_trace_sessions` map projection table
   (TenantId, TraceId → SessionId) in the same migration.
3. **Metric contributor.** Subscriber on metric-processing lifting
   session-keyed series; `session_metric_series` table
   (`00052`, Replacing, converged totals per ADR-056 §5) + map projection.
   Fold overlays metric-fed fields (LOC/commits/PRs/edit decisions/
   active-time) into the session row via contributions — the read-time
   rollup scan from #5708 is not ported.
4. **Read layer.** `coding-agent-session.service` + repository (port +
   adapt): `getBySessionId`, `getSessionForTrace` (two keyed seeks via
   trace_sessions), `listByUser` (personal usage; UserId + StartedAt range).
   Port `coding-agent-session-merge.ts` semantics where still needed.
5. **Terminal view port (independent — may land any time after 0).**
   The trace-enrichment surface, unchanged in shape: terminalView/**, ansi
   utils, `terminalOrigin.ts`, `useSpanLogs`, transcript derivation +
   `tracesV2.codingAgentTranscript` + `traceLogs` endpoints,
   `getLogsByTraceId` on the canonical log repository,
   `log-content-derivation.ts`, `claude-code-log-enrichment.ts`,
   `claude-code-span-enrichment.ts`, waterfall/conversation/accordions
   diffs, `SyntheticTraceBadge`, drawer shell/shortcut/mode fixes.
6. **Session tab port.** sessionView/** rewired to `getSessionForTrace`;
   trace-summary/analytics fold diffs from the old branch that feed
   session titles + synthetic markers (`traceSummary.foldProjection`,
   `traceAnalytics.foldProjection`, `trace-io-accumulation.service`).
   Collapse correlation source to generic `synthesized` (keep old values
   parse-accepted; derive `derived_from` from `ProviderKind`).
7. **Personal usage.** `/me` card off `listByUser` (+ the
   `PersonalTracesEmptyState` / `IngestionTemplateInstallDrawer` diffs).
8. **Retire legacy + aftercare.** Delete from main:
   `claudeCodeSpanSync.reactor.ts`, `claude-code-log-to-span.ts`, their
   pipeline registration + tests, `specs/traces-v2/claude-code-log-conversion.feature`,
   and any `CLAUDE_CODE_LOG_RETENTION_DAYS` floor. Port dogfood matrix
   (`scripts/dogfood/coding-agent-matrix.sh`, `e2e/capture-coding-agent-matrix.ts`)
   and run it end-to-end. Release note: log-only installs must re-run
   `langwatch claude`. Close #5708, delete its branch.

Verification per slice: the old branch's ported test suites (adapted keys)
plus new fold/contribution tests; scenario coverage tracks the two feature
files. Full dogfood only at slice 8.

## Port manifest (from `feat/claude-code-enhanced-telemetry-beta`, 181 files)

### PORT AS-IS (trace-enrichment surface + fixes; slice 5 unless noted)
- `features/traces-v2/components/TraceDrawer/terminalView/**` (15 files + tests)
- `features/traces-v2/utils/ansi/ansi.ts`, `utils/terminalOrigin.ts`, `utils/formatters.ts` (diff)
- `features/traces-v2/hooks/useSpanLogs.ts`, `traceDrawerShortcutTable.ts`,
  `useTraceFreshness.ts`, `useTraceListRefresh.ts`, `stores/drawerStore.ts` (diffs)
- `TraceDrawer/`: `ModeSwitch`, `TraceDrawerShell`, `conversationView/*`
  (incl. new `TurnSteps.tsx`), `waterfallView/*`, `traceAccordions/*`
  (incl. new `logSummary.ts`), `transcript/ToolBlocks`, `markdownView/shikiAdapter`,
  `drawerHeader/DrawerHeader` + `SyntheticTraceBadge.tsx` (diffs)
- `server/app-layer/traces/`: `coding-agent-transcript.derivation.ts`,
  `log-content-derivation.ts`, `claude-code-log-enrichment.ts`,
  `claude-code-span-enrichment.ts`, `coding-agent-span-filter` (if referenced)
- `server/api/routers/tracesV2.ts` (transcript + traceLogs endpoints; session
  endpoints adapt in slice 6)
- `canonical-log-record.repository/.clickhouse.repository` — **only**
  `getLogsByTraceId` (NOT the marked-read methods)
- extractors: `claudeCode.ts`, `_messages.ts`, `_geminiContent.ts`, new `_parts.ts` (diffs)
- `metric-data-point.repository/.clickhouse.repository` diffs (exemplar/TTFT read)
- `server/traces/trace.service.ts` diff (legacy enrichment wiring)
- `log-record-storage.*` + `log-request-collection.service.ts` diffs — port
  minus the `CLAUDE_CODE_KIND_ATTR` marking block
- misc fixes: `scripts/seed-local-admin.ts`, `workers.ts` (`.env.portless`
  overlay), `.gitignore`, `sdk-javascript-ci.yml`,
  `typescript-sdk` installer diffs (`install.ts`, `wrapper-mode.ts`)
- specs to port into `specs/coding-agent/`:
  `coding-agent-terminal-view.feature`, `coding-agent-trace-fidelity.feature`
  (from old `specs/trace-processing/`), plus diffs to
  `specs/claude/telemetry-turn-bounding.feature`,
  `specs/ai-gateway/governance/ingestion-templates-catalog.feature`
- docs: `dev/docs/claude-code-terminal-view.md`; media assets
- dogfood: `scripts/dogfood/coding-agent-matrix.sh`, `e2e/capture-coding-agent-matrix.ts` (slice 8)

### ADAPT / REWRITE into the new pipeline (slices 1–4, 6)
- `projections/services/coding-agent-normalization.ts` → pipeline services (slice 1)
- `projections/services/coding-agent-session.derivation.ts` + `.types.ts`,
  `code-agent-summary.service.ts` → session fold, re-keyed (slice 2)
- `projections/codingAgentSession.foldProjection.ts` + `.store.ts` → new
  pipeline fold + store (slice 2); projection version restarts fresh
- `00051_create_coding_agent_sessions.sql` → re-cut session-keyed (slice 2)
- `app-layer/traces/coding-agent-session.service.ts` + repositories +
  `coding-agent-session-merge.ts` → read layer (slice 4)
- `sessionView/**` → rewired reads (slice 6)
- `traceSummary.foldProjection.ts` / `traceAnalytics.foldProjection.ts` /
  `trace-io-accumulation.service.ts` diffs → slice 6
- `log-processing/canonicalLog.ts` + `schemas/logRecord.ts` diffs → slice 6
  (generic `synthesized` value; old values parse-accepted)
- `trace-processing/pipeline.ts` / `recordSpanCommand.ts` /
  `recordLogContributionCommand.ts` / `logCommandGroupKey.ts` /
  `schemas/otlp.ts` diffs → take only what the new shape needs (span
  contribution seam; link schema bits if not already on main)
- `pipelineRegistry.ts`, `app-layer/dependencies.ts`, `presets.ts` → new
  pipeline wiring (slice 1)
- `components/me/*` + `pages/me/index.tsx` → slice 7

### DROP (verified dead on the old branch — grep-proven audit)
- `claude-code-log-marking.ts` (write-only KIND/PII marking, zero readers)
- `claude-code-log-events.ts` (scope consts only the marking used)
- `getMarkedClaudeCodeLogsByTrace` / `countMarkedClaudeCodeLogsByTrace`
- `coding-agent-transcript.service.ts` (bypassed wrapper; router uses the
  derivation directly)
- `app-layer/traces/synthesize-trace-context.ts` (dead duplicate of
  `canonicalLog.ts`'s live `synthesizeCorrelation`)
- the legacy raw-log dual path in the session fold
  (`handleTraceLogRecordReceived`) — the new pipeline consumes canonical
  contributions only
- old branch's `dev/docs/claude-code-*-plan.md` + draft ADR-041 (superseded
  by ADR-056 + this plan)

### DELETE from main (slice 8)
- `trace-processing/reactors/claudeCodeSpanSync.reactor.ts` (+ registration, tests)
- `app-layer/traces/claude-code-log-to-span.ts`
- `specs/traces-v2/claude-code-log-conversion.feature`
- any remaining `CLAUDE_CODE_LOG_RETENTION_DAYS` floor
