# Runbook — E2E test coding-agent cost intelligence locally

Verify the ADR-033 content-block cost-intelligence feature end-to-end by running a
real `langwatch claude` session against a local server and reading the
cost-by-category dashboards back.

**The feature is 100% server-side.** The CLI needs no rebuild — it already ships
Claude Code spans under the `com.anthropic.claude_code.events` scope with content.
All you do is: run *this* worktree's server with one flag on, point the CLI's
endpoint at it, run a session, and read it back.

Related: ADR `dev/docs/adr/033-coding-agent-cost-intelligence.md` · spec
`specs/trace-processing/content-block-cost-attribution.feature` · known-gaps
issue #5332 (`memory_context` / `skill_invocation` lanes are empty by design).

---

## The one non-obvious gotcha

Both dashboards — `/me` (Usage breakdown) and `/settings/governance` (org-wide
Usage breakdown) — are gated behind the feature flag
**`release_ui_ai_governance_enabled`**. Data classifies and stores correctly
without it, but the page is empty. Force-enable it in dev via
`FEATURE_FLAG_FORCE_ENABLE`, and it must reach **both the app and the workers**
(the workers run the ingest-time classification + the trace fold), so put it in
`langwatch/.env` — not an inline shell var, which compose workers won't inherit.

---

## A · Run the feature server from this worktree

Workers are required — they run the ingest-time classification and the fold.

```bash
# From the worktree root:
echo 'FEATURE_FLAG_FORCE_ENABLE=release_ui_ai_governance_enabled' >> langwatch/.env
make down                       # stop whatever currently holds the ports
make quickstart all-local       # local PG + CH + Redis + app + workers
```

`all-local` gives a fully local stack (no shared dev infra), so nothing you
generate touches a shared environment. App serves on `:5560`, ClickHouse on
`:8123`.

> If a server is already answering on `:5560`, you can't be sure it's this
> branch — restart from here for certainty.

## B · Point the CLI at local

Your global `langwatch` is fine (server-side feature). The wrapper reads env
directly — the deterministic path, no login prompts:

```bash
export LANGWATCH_ENDPOINT=http://localhost:5560
export LANGWATCH_API_KEY=<your local project key>   # see langwatch/.env / local project settings
```

Endpoint precedence in the CLI is: `--endpoint` flag > `LANGWATCH_ENDPOINT` env >
`~/.langwatch/config.json:control_plane_url` > cloud default. The persistent
alternative that writes the config file:

```bash
langwatch login --endpoint http://localhost:5560
```

## C · Generate a real session, then read it back

```bash
langwatch claude        # run a small task; use a skill / MCP tool / file read for richer lanes
```

This spawns your Claude Code, ships claude-scoped spans **with content** to local
→ the server classifies each content block at ingest and folds category totals
onto the trace summary.

Read it back three ways:

- **Personal UI:** `http://localhost:5560/me` → "Usage breakdown"
- **Org UI:** `http://localhost:5560/settings/governance` → "Usage breakdown"
- **Ground truth (ClickHouse):** sums the reserved per-category attributes and
  proves conservation (Σ per-category cost == the trace's real cost):

  ```bash
  curl -s 'http://localhost:8123/?database=langwatch' --data-binary "
  SELECT
    replaceRegexpOne(k, '^langwatch.reserved.blockcat.(.*)\\.cost_usd\$', '\\1') AS category,
    round(sum(toFloat64(v)), 8) AS cost_usd
  FROM langwatch.stored_spans
  ARRAY JOIN mapKeys(SpanAttributes) AS k, mapValues(SpanAttributes) AS v
  WHERE TraceId = '<your-trace-id>'
    AND k LIKE 'langwatch.reserved.blockcat.%.cost_usd'
  GROUP BY category ORDER BY cost_usd DESC FORMAT TSV"
  ```

## What to expect

- ~13 lanes populate: `system_prompt`, `tool_definitions`, `mcp_tool_definitions`,
  `skill_content`, `prior_context`, `tool_result_builtin/mcp`, `assistant_text`,
  `tool_call_builtin/mcp`, `thinking`, `user_input`, `other_input`.
- `memory_context` and `skill_invocation` stay **empty by design** — no v1
  heuristic emits them (issue #5332). CLAUDE.md rides inside `<system-reminder>` →
  `prior_context`; a skill run is a `tool_use` → `tool_call_*`.
- **Σ per-category cost == the trace's real cost** (the conservation invariant).
  Real Claude Code spans carry their own `cost_usd`, which the display trusts
  over the token×registry estimate — the reconciliation logic that keeps the
  category sum equal to that displayed cost is exactly what this end-to-end run
  exercises.

## No classification? Check in order

1. Flag not set in the **worker** env → put it in `langwatch/.env`, restart.
2. Server not this branch → `make down` then `make quickstart all-local` here.
3. Span carries no content → only `langwatch claude` / `langwatch codex` sessions
   classify; a plain OTel app won't (wrong scope + no captured content).
4. Workers not running → `all-local` starts them; confirm the worker process is up.
5. Nothing in ClickHouse → ingestion is async; wait a few seconds, re-query.

## Fast synthetic alternative (no Claude Code session)

To exercise the pipeline without a real agent run, POST a crafted
claude-scoped OTLP/JSON payload to `${ENDPOINT}/api/otel/v1/traces` with an
`X-Auth-Token: <api key>` header — one trace, instrumentation scope
`com.anthropic.claude_code.events`, spans carrying `langwatch.input`
(`chat_messages` with system / marked-up user / tool blocks), `gen_ai.usage.*`
tokens, and either `langwatch.model.*CostPerToken` rates or a `langwatch.span.cost`.
Then read it back with the ClickHouse query above. Useful for deterministic,
repeatable coverage of every taxonomy lane.
