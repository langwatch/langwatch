# ADR-192: Grok as a natively instrumented coding agent

**Date:** 2026-11-01

**Status:** Proposed

## Context

Grok, xAI's coding CLI (`grok`, captured at 1.0.70), exports OpenTelemetry
natively once `GROK_EXTERNAL_OTEL=1` is set. Four live sessions were captured
against a local receiver: a plain turn, a subagent, a resumed session and a
model switch. What arrived is Claude Code's telemetry design almost key for
key:

- OTLP/HTTP protobuf, gzip, the Bearer header honoured; logs and metrics,
  no spans.
- Log records named `grok_code.<event>` with the name in the LogRecord
  `event_name` field: `user_prompt`, `assistant_response`, `api_request`,
  `tool_decision`, `tool_result`, plus lifecycle events (`session_start`,
  `session_end`, `turn_completed`, `subagent`, `model_switched`,
  `mcp_server_connection`).
- `session.id`, `prompt.id` and `event.sequence` on every turn event.
- Metrics `grok_code.token.usage` (typed input, output, reasoning,
  cache_read) and `grok_code.cost.usage`.
- Claude Code-compatible hooks: matcher groups, the same snake_case payload,
  `GROK_SESSION_ID` in the hook environment. The hook's session id equals the
  telemetry `session.id`.

It differs from Claude Code in five places:

1. The resource is fixed (`service.name=grok-cli`, scope `ai.xai.grok_code`)
   and `OTEL_RESOURCE_ATTRIBUTES` is ignored.
2. `input_tokens` includes `cache_read_tokens`.
3. Cost is `cost_usd_micros`, an integer.
4. A subagent runs under a new session id; its telemetry names no parent.
5. Grok loads `~/.claude/settings.json` hooks and Claude plugins by default,
   so the LangWatch Claude hook already runs inside every Grok session.

Top-level prompts also arrive wrapped in `<user_query>` tags, which the shared
title derivation rejects.

## Decision

We will add Grok as a logs-only coding agent that follows the Claude Code
pattern, with no Grok-shaped branch in the session fold.

1. **Agent definition.** `grok` joins `codingAgentSchema` and
   `CODING_AGENT_REGISTRY` from `grok.ts`: `logsOnly`, `logsRequireSessionKey`,
   name prefix `grok_code.`. It matches `signalSays(signal, "grok_code")` (the
   name prefix, or a scope or service containing `grok_code`, which covers the
   scope `ai.xai.grok_code`) or the exact service `grok-cli`. It never matches
   on a model name: `grok-*` models also run behind other agents and the
   gateway. The receiver reads the event name from the LogRecord `event_name`
   field (OTLP field 12), which the pinned decoder skips, so
   `packages/otlp/src/log-event-name.ts` restores it.
2. **Source type `grok_cli`, tool slug `grok`.** Personal ingest keys are
   minted for `grok_cli`; the receiver stamps the coding-agent origin; the
   platform policy is `{ allowVk: false, allowOtelDirect: true }`. Attribution
   comes from the key alone.
3. **Figures restated before the fact allowlist.** The definition declares
   cache-inclusive input (`logInputIncludesCacheRead`) and micro-dollar cost
   (`logCostUsdMicrosAttribute: "cost_usd_micros"`); the log-facts rule
   restates `input_tokens` as `max(0, input - cache_read)` and, when no
   `cost_usd` is present, sets it to `cost_usd_micros / 1e6`. The fold's
   figures are unchanged. Grok's other spellings are read where every agent's
   are, with no Grok branch: a `False` flag, `mcp_server_name`, and its
   tool decisions (`allow`, `deny`, `followup`, `cancelled`) through the
   shared `toolDecisionOutcome` (`contract/src/telemetry/tool-decision.ts`).
4. **Synthesized correlation.** Grok joins Claude's synthesis branch (turn
   keyed on session id and prompt id, recognised by the scope
   `ai.xai.grok_code`); the log provider kind gains `grok`, and its
   synthesized correlations are marked `grok_synthesized`.
5. **Subagents are rows of their own with lineage.** The row model already
   carries `ParentSessionId`. LangWatch's Grok hook listens on
   `SubagentStart`, which fires in the parent with the child's id as
   `subagentId`, and posts a context record for the child carrying
   `parent_session_id`.
6. **Hook file.** LangWatch owns `~/.grok/hooks/langwatch.json` (following
   `GROK_HOME`), owned whole as Copilot's file is but written in Claude Code's
   hook format, which Grok reads, running `langwatch ingest hook grok` on
   `SessionStart`, `Stop` and `SubagentStart`. Both
   `langwatch ingest install grok_cli` and every `langwatch grok` launch
   write it, and `langwatch logout` removes it.
7. **Claude hook steps aside in Grok.** `langwatch ingest hook claude-code`
   and the Claude plugin's launcher both exit silently when `GROK_HOOK_EVENT`
   is set, so Grok sessions never post a Claude record.
8. **Prompt title.** The shared title derivation unwraps a prompt that is
   wholly one `<user_query>` block.
9. **Ingestion only.** `langwatch grok` injects `GROK_EXTERNAL_OTEL=1`, the
   logs and metrics exporters, endpoint, headers, protocol (`http/protobuf`)
   and the four `OTEL_LOG_*` content gates, and no traces exporter or
   `OTEL_RESOURCE_ATTRIBUTES`, which Grok ignores. Grok reads its exporter
   only from the environment, so a bare `grok` run reports only while the
   scoped shell function in the user's shell rc re-injects it. No gateway
   path.

## Rationale / Trade-offs

Every Grok difference is absorbed where the vocabulary already lives
(ADR-056 Decision 7): the definition declares it, one rule acts on the
declaration. Restating figures in the fold would have put Grok knowledge in
the pipeline; a span-normalisation extractor would have been the wrong layer,
since the coding-agent fold reads the raw log attributes. The one Grok
canonicaliser (`packages/span-normalisation/src/grokCanonicaliser.ts`) serves
the trace, not the fold: it names the trace's model and touches no figure.

Subagents as separate rows differ from Claude Code, whose subagents share the
parent's session id. Merging a Grok child into its parent would need a new
re-keying step; linking through the existing lineage column needs none, and
keeps each row's cost truthful. A session list that groups children under
parents is a presentation change open to every agent that stamps lineage.

No gateway path: Grok sets model endpoints in `config.toml` entries, not in
environment, and a grok.com plan authenticates with a session token rather
than an API key. Writing the user's model config is out of proportion for v1.

## Consequences

- Grok sessions appear in the session list, priced from Grok's reported cost,
  as every logs-only agent's are: there is no model-call span to price.
- A Grok trace has no spans, so its terminal banner takes the agent, version
  and model from the trace's log records, and the trace's model, origin and
  duration come from them too (Revisions, v3).
- The analytics store (`trace-derived.projection.ts`) still ignores log
  times, so analytics charts show 0 ms for a Grok trace.
- Grok has no tool spans, so its tool runs reach the transcript from its
  `tool_result` events (`coding-agent-transcript-log.ts`).
- Users running Grok with the Claude hooks installed stop getting a phantom
  Claude row per Grok session.
- Global hooks run only in a folder Grok trusts, as Claude Code asks for
  workspace trust; an untrusted folder's session has no repository or branch.
- Prompts, responses, tool I/O and home paths arrive with the gates on, so
  ingest-time PII redaction applies as it does for Claude Code.

## Revisions

- **v1 (2026-11-01)**: proposed with the implementation (#9224).
- **v2 (2026-11-05)**: checked against what shipped (#9300). Decisions 1,
  3, 4, 6 and 9 now state the shipped detail: the `event_name` decoder, the
  exact match predicate, the micro-dollar fallback, the shared tool-decision
  reading, the `grok_synthesized` marker, who writes and removes the hook
  file, and the shell-function path for bare runs. The banner consequence
  is restated as shipped. No decision changed.
- **v3 (pending, #9350)**: the trace a Grok session leaves (#9307, #9308,
  #9309). As shipped in #9224 it showed no banner, no model, no coding-agent
  origin and no duration.
  - Banner (#9307). The mark is Grok's own welcome-screen art from a live
    grok 1.0.70 capture, 7 rows of braille in xterm grey 242 (`#6c6c6c`),
    the colour kept inline in the Grok entry (`terminal-view.tsx:998`).
    The banner keeps the first word of `service.version`, so
    `1.0.70 (f50904eaee6c)` reads `Grok v1.0.70`; this drops a build
    suffix for every agent (`terminal-session-banner.ts:151`). With no
    spans, the banner takes the agent, version and model from the trace's
    log records (`:88-98`). The terminal tab reads the logs only when the
    trace has no spans (`terminal-tab.tsx:64`, `useTraceLogsRead` in
    `use-trace-detail-reads.ts:33`), so agents with spans pay no extra read.
  - Model (#9308). `grokCanonicaliser.ts`, keyed on the scope
    `ai.xai.grok_code`, copies a log record's `model` onto
    `langwatch.model`, so the trace's Model column, header and grouping
    show it (test `grokCanonicaliser.unit.test.ts`). The banner uses the
    last record that names a model, and only when no model-call span names
    one.
  - Origin (#9309). A log record passes the receiver's `langwatch.origin`
    stamp, set from the ingest key's source type, to its trace
    (`log-request-collection.service.ts:243`). It only fills an empty
    origin, in `trace-summary.projection.ts` and
    `trace-derived.projection.ts`, and never overrides one a span set
    (test `log-request-collection.service.unit.test.ts`).
  - Duration (#9309). Only a synthesized correlation, where no span shares
    the trace id, gets a time window, from the first record to the last
    (`accumulateLogTiming` in `span-timing-fold.ts:53`). A record whose
    clock is more than 24 hours off its accept time is ignored (`:46`),
    because the trace's start time also anchors storage (ADR-071). Test:
    `trace-summary.projection.log-only-trace.unit.test.ts`. The analytics
    store's gap is under Consequences.
  - Prompt line. The terminal prompt line skips a stand-in name: a span
    name or, on a logs-only trace, a prefix of the trace id
    (`promptLineText` in `terminal-session.ts:9`; `terminal-view.feature`,
    "The prompt line never shows a trace id as if the user had typed it").
  - Proven on a local stack by replaying a real grok 1.0.70 OTLP log
    capture: origin `coding_agent`, model `grok-4.7`, duration 521.6 s,
    banner `Grok v1.0.70` with the art, and the prompt line
    `Reply with just hi`.

## References

- Related ADRs: ADR-039 (wrappers and ingest keys), ADR-056 (session
  aggregate)
- Specs: `specs/ai-governance/ingestion-sources/grok-cli-otlp.feature`,
  `specs/coding-agent/grok-sessions.feature`,
  `specs/coding-agent/grok-model-calls.feature`,
  `specs/ai-governance/cli-wrappers/grok-env-injection.feature`,
  `specs/ai-governance/cli-wrappers/grok-hook-install.feature`
