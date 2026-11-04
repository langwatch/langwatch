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
   name prefix `grok_code.`, matching service `grok-cli`, scope
   `ai.xai.grok_code` or the prefix. It never matches on a model name.
2. **Source type `grok_cli`, tool slug `grok`.** Personal ingest keys are
   minted for `grok_cli`; the receiver stamps the coding-agent origin; the
   platform policy is `{ allowVk: false, allowOtelDirect: true }`. Attribution
   comes from the key alone.
3. **Figures restated before the fact allowlist.** The definition declares
   cache-inclusive input and micro-dollar cost; the log-facts rule restates
   `input_tokens` as `max(0, input - cache_read)` and `cost_usd` as
   `cost_usd_micros / 1e6`. The fold is unchanged.
4. **Synthesized correlation.** Grok joins Claude's synthesis branch (turn
   keyed on session id and prompt id); the log provider kind gains `grok`.
5. **Subagents are rows of their own with lineage.** The row model already
   carries `ParentSessionId`. LangWatch's Grok hook listens on
   `SubagentStart`, which fires in the parent with the child's id as
   `subagentId`, and posts a context record for the child carrying
   `parent_session_id`.
6. **Hook file.** LangWatch owns `~/.grok/hooks/langwatch.json` (following
   `GROK_HOME`), owned whole as Copilot's file is but written in Claude Code's
   hook format, which Grok reads, running `langwatch ingest hook grok` on
   `SessionStart`, `Stop` and `SubagentStart`.
7. **Claude hook steps aside in Grok.** `langwatch ingest hook claude-code`
   and the Claude plugin's launcher both exit silently when `GROK_HOOK_EVENT`
   is set, so Grok sessions never post a Claude record.
8. **Prompt title.** The shared title derivation unwraps a prompt that is
   wholly one `<user_query>` block.
9. **Ingestion only.** `langwatch grok` injects `GROK_EXTERNAL_OTEL=1`, the
   logs and metrics exporters, endpoint, headers, protocol and the four
   `OTEL_LOG_*` content gates. No gateway path.

## Rationale / Trade-offs

Every Grok difference is absorbed where the vocabulary already lives
(ADR-056 Decision 7): the definition declares it, one rule acts on the
declaration. Restating figures in the fold would have put Grok knowledge in
the pipeline; a span-normalisation extractor would have been the wrong layer,
since the coding-agent fold reads the raw log attributes.

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
- The terminal banner names Grok and its version but no model, which it reads
  off model-call spans.
- Users running Grok with the Claude hooks installed stop getting a phantom
  Claude row per Grok session.
- Global hooks run only in a folder Grok trusts, as Claude Code asks for
  workspace trust; an untrusted folder's session has no repository or branch.
- Prompts, responses, tool I/O and home paths arrive with the gates on, so
  ingest-time PII redaction applies as it does for Claude Code.

## References

- Related ADRs: ADR-039 (wrappers and ingest keys), ADR-056 (session
  aggregate)
- Specs: `specs/ai-governance/ingestion-sources/grok-cli-otlp.feature`,
  `specs/coding-agent/grok-sessions.feature`,
  `specs/coding-agent/grok-model-calls.feature`,
  `specs/ai-governance/cli-wrappers/grok-env-injection.feature`,
  `specs/ai-governance/cli-wrappers/grok-hook-install.feature`
