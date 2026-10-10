---
name: coding-agent-cost
user-prompt: "Where can my coding agents save tokens?"
description: Reads your Claude Code sessions in LangWatch and recommends the settings that cut their cost and context, each with the evidence from your own data, the exact settings.json change and the expected saving marked as measured or estimated. Covers older model versions, the auto-compact window, the prompt cache lifetime for API-key and subscription users, the model your built-in sub-agents run on, and sessions that should have been split. Use when someone asks why their coding agents cost so much, how to make a Claude Code plan last longer, or which Claude Code settings to change.
license: MIT
compatibility: Works with Claude Code and similar AI assistants. The `langwatch` CLI is the only interface.
---

# Cut Your Coding Agent's Cost and Context

This skill reads the user's own Claude Code sessions from LangWatch, runs one check per recommendation below, and reports only the recommendations their data supports. Every recommendation names the evidence, the exact setting and an expected saving, and says whether that saving was measured in a controlled run or estimated from token counts. It is read-only on the platform and leaves one report file behind.

## Step 1: Set up the LangWatch CLI

Use the `langwatch` CLI for everything: documentation (`langwatch docs ...`, `langwatch scenario-docs ...`) and platform operations (prompts, scenarios, evaluators, datasets, monitors, traces, analytics). Install it once with `npm install -g langwatch`, then run the `langwatch` binary directly; an unpinned `npx langwatch` re-resolves the package from the registry on every run.

Coding-agent sessions live in the user's personal LangWatch workspace by default. `langwatch login --device` signs this machine in; add `--project <slug>` on every read command when the sessions live in a team project instead.

## Step 2: Find Out How the User Pays

The same tokens mean different things to different users, so settle this before any number goes in the report.

- **Claude subscription (Pro, Max, Team, Enterprise seats):** no per-token bill. A saving means more work before the plan's usage limits, not cash. Show USD as "API-equivalent usage" in brackets.
- **API key, Amazon Bedrock, Google Cloud, Microsoft Foundry, or a subscription drawing on usage credits:** every token is billed. A saving is cash.

Ask the user, or check on their machine: run `claude -p "hello" --output-format json` and read `usage.cache_creation`. One-hour writes (`ephemeral_1h_input_tokens` above zero) on that main-conversation request mean a subscription within plan usage. Five-minute writes (`ephemeral_5m_input_tokens`) mean an API key, a cloud provider or usage credits. Check 5 below also reads this from the data.

## Step 3: Pull the Data

Every query below is LangWatchQL, run with `langwatch query run "<sql>" -o json`. Run `langwatch query schema` once to confirm the column names. Use one window everywhere, 30 days unless the user names another, and aggregate in SQL: a result is capped at 10,000 rows.

`langwatch.coding_session_events` holds one row per event. Model calls have `EventKind = 'model_call'` with `Model`, `InputTokens`, `OutputTokens`, `CacheReadTokens`, `CacheCreationTokens`, `CostUsd`, `TimeUnixMs` and `QuerySource`. `QuerySource` tells threads apart: `repl_main_thread%` or `sdk` is the main conversation, `agent:builtin:<type>` and `agent:custom` are sub-agents, `agent_summary` is a sub-agent's final report, `compact` is a compaction. The context a call carried is `InputTokens + CacheReadTokens + CacheCreationTokens`.

Without `--project`, a query reads every project the login can reach, so check the scope first:

```sql
SELECT TenantId, count() AS calls, round(sum(CostUsd), 2) AS cost_usd
FROM langwatch.coding_session_events
WHERE EventKind = 'model_call' AND TimeUnixMs >= now() - INTERVAL 30 DAY
GROUP BY TenantId ORDER BY cost_usd DESC
```

If more than one project comes back, ask whether the report covers the user's own sessions or the whole team. For one project, pass `--project <id or slug>` to every query below; on a LangWatch server older than this flag's support, also add `AND TenantId = '<id>'`.

`langwatch.coding_sessions` holds one row per session, with `Title`, `PeakContextTokens`, `Compactions`, `Models`, `SubAgentTypes`, `CostUsd`, `StartedAt` and `UserId`. Use it to name example sessions.

Start with the spend mix:

```sql
SELECT Model,
  multiIf(QuerySource LIKE 'repl_main_thread%' OR QuerySource = 'sdk', 'main',
          QuerySource LIKE 'agent%', 'subagent', 'other') AS thread,
  count() AS calls, sum(InputTokens) AS input, sum(OutputTokens) AS output,
  sum(CacheReadTokens) AS cache_read, sum(CacheCreationTokens) AS cache_write,
  round(sum(CostUsd), 2) AS cost_usd
FROM langwatch.coding_session_events
WHERE EventKind = 'model_call' AND TimeUnixMs >= now() - INTERVAL 30 DAY
GROUP BY Model, thread ORDER BY cost_usd DESC
```

Fetch Anthropic's current price list (https://platform.claude.com/docs/en/about-claude/pricing) before repricing anything, and cite it with the fetch date. Never price from memory. The multipliers to check there: a five-minute cache write costs 1.25x the base input price, a one-hour write 2x, a cache read 0.1x on most models and less on some newer ones.

## Step 4: Run the Checks

Run each check, keep the ones that fire, and price each saving on the user's own tokens. The expected ranges below come from 105 organisations' Claude Code data on LangWatch (30 days, API-equivalent USD). Each is labelled **measured** (a controlled A/B run on the same tasks) or **estimated** (the same tokens repriced or re-simulated). Say which one in the report.

### 1. Older model version

**Fires when** 1% or more of spend is on a model that has a cheaper successor in the same tier: Opus 5 or Opus 4.5 to 4.8 (successor Opus 5.5), Sonnet 5 or Sonnet 4.x (Sonnet 5.5), Fable 5 (Fable 5.1). Use the spend mix from Step 3.

**Saving:** reprice the same input, output, cache-read and cache-write tokens at the successor's prices. Cache reads usually dominate coding-agent spend, so the read price difference drives the result. Across organisations where this fires (88% of them) the estimated median is 24% of Claude Code spend, p90 42%. Models from Opus 4.6 back use an older tokenizer that counts fewer tokens for the same text, so the gap for those is smaller than repricing shows.

Measured in a controlled run: on 5 bug-fix tasks (15 runs per model, every hidden test passed with both), Opus 5.5 cost 63% less than Opus 5 per task (95% CI 56 to 69%). The price list explains about 33 points; the rest came from fewer tokens, with half the cache reads, a third of the output and a median of 17 s per task against 51 s.

**Setting:** in `~/.claude/settings.json` (or managed settings for a team), use the alias instead of a pinned id, and check that no `ANTHROPIC_MODEL`, `ANTHROPIC_DEFAULT_OPUS_MODEL` or `ANTHROPIC_DEFAULT_SONNET_MODEL` in the `env` block pins the old one:

```json
{ "model": "opus" }
```

### 2. Main conversation past 400k tokens of context

**Fires when** main-thread calls carry more than 400,000 tokens of context. Every call re-reads the whole history from cache, so cost per call grows with context.

```sql
SELECT SessionId, max(InputTokens + CacheReadTokens + CacheCreationTokens) AS peak_context,
  countIf(InputTokens + CacheReadTokens + CacheCreationTokens > 400000) AS calls_over_400k,
  round(sum(CostUsd), 2) AS cost_usd
FROM langwatch.coding_session_events
WHERE EventKind = 'model_call' AND (QuerySource LIKE 'repl_main_thread%' OR QuerySource = 'sdk')
  AND TimeUnixMs >= now() - INTERVAL 30 DAY
GROUP BY SessionId HAVING calls_over_400k > 0 ORDER BY cost_usd DESC LIMIT 50
```

**Saving:** simulate compaction at 400k per session: after compacting, the thread restarts at about 40k tokens and grows again, so a call at context `c` above 400k would carry about `40000 + ((c - 400000) mod 360000)`. Saving = removed tokens x read price, minus each compaction (one read of 400k plus about 40k output and 40k write). Estimated median 7% of spend (p90 23%) where it fires, and about 29% on threads that pass 800k.

Measured in a controlled run (4 runs per arm): a session that read 145 files one per turn and peaked at 488k tokens cost 51% less with a 150k window than with the default, with 73% fewer cache reads. The agent then answered 0 of 6 questions about early files, against 6 of 6 without compaction, so do not set the window far below 400k, and expect details from before a compaction to need re-reading.

**Setting:** in `settings.json`, and remove any `CLAUDE_CODE_AUTO_COMPACT_WINDOW` from `env` blocks first, because the environment variable wins over the setting:

```json
{ "autoCompactWindow": 400000 }
```

Also: `/compact` at the end of a task, `/clear` before an unrelated one.

### 3. Sub-agents past 600k tokens of context

**Fires when** sub-agent calls (`QuerySource LIKE 'agent%'`) carry more than 600,000 tokens. Use check 2's query with that filter and the threshold changed. The data has no sub-agent id, so count calls, not threads.

**Saving:** the same simulation. Estimated 35% of what those sub-agents cost, but only 18% of organisations that use sub-agents have any, median 2% of total spend. Say "these sub-agents", not "your bill".

**Setting:** the same `autoCompactWindow` applies to sub-agents. The other fix is narrower sub-agent tasks, for example one sub-agent per module instead of one for the whole repository.

### 4. Opus or Fable on built-in sub-agents

**Fires when** `agent:builtin:Explore`, `agent:builtin:general-purpose` or `agent_summary` calls run on an Opus or Fable model.

```sql
SELECT QuerySource, Model, count() AS calls, round(sum(CostUsd), 2) AS cost_usd
FROM langwatch.coding_session_events
WHERE EventKind = 'model_call' AND TimeUnixMs >= now() - INTERVAL 30 DAY
  AND (QuerySource LIKE 'agent:builtin:%' OR QuerySource = 'agent_summary')
GROUP BY QuerySource, Model ORDER BY cost_usd DESC
```

**Saving:** reprice those calls at Sonnet 5.5. Estimated median 4% of spend (p90 19%) where it fires (73% of organisations). Overlaps with check 1 when the sub-agents run an old Opus, so do not add the two. Searching and reading code rarely needs the top model, but say that the user should watch the quality of the sub-agents' reports for a week.

**Setting:** there is no top-level settings key for this. Set the `CLAUDE_CODE_SUBAGENT_MODEL` variable in the `env` block of `settings.json`. On its own it moves general-purpose and any custom agent without a `model:` line; Explore and Plan stay on the main conversation's model:

```json
{ "env": { "CLAUDE_CODE_SUBAGENT_MODEL": "sonnet" } }
```

To move Explore and Plan too, add `"CLAUDE_CODE_SUBAGENT_MODEL_FORCE": "1"` to the same block (Claude Code v2.1.257 or later). It also overrides custom agents' `model:` lines and the model Claude picks for a single call, so suggest it only when no custom agent needs a stronger model. To move only Explore, the user can define an agent named `Explore` with `model: sonnet` in `~/.claude/agents/`.

### 5. API key: the five-minute cache is rebuilt after pauses

Applies only to users who pay per token (Step 2). On an API key, Bedrock, Google Cloud or usage credits, Claude Code caches every request for five minutes. A pause of 5 to 60 minutes (reading a diff, a meeting, a long test run) expires the cache, and the next call writes the whole context again.

```sql
SELECT Model, count() AS calls, sum(cw) AS write_tokens,
  countIf(gap > 300 AND gap <= 3600) AS pauses_5_to_60_min,
  countIf(gap > 300 AND gap <= 3600 AND cw > 0.5 * ctx AND ctx > 20000) AS rebuilds_5_to_60_min,
  sumIf(cw, gap > 300 AND gap <= 3600 AND cw > 0.5 * ctx AND ctx > 20000) AS rebuild_tokens
FROM (
  SELECT Model, CacheCreationTokens AS cw,
    InputTokens + CacheReadTokens + CacheCreationTokens AS ctx,
    dateDiff('second', lagInFrame(TimeUnixMs) OVER w, TimeUnixMs) AS gap,
    row_number() OVER w AS rn
  FROM langwatch.coding_session_events
  WHERE EventKind = 'model_call' AND (QuerySource LIKE 'repl_main_thread%' OR QuerySource = 'sdk')
    AND TimeUnixMs >= now() - INTERVAL 30 DAY
  WINDOW w AS (PARTITION BY SessionId ORDER BY TimeUnixMs
               ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING)
)
WHERE rn > 1 GROUP BY Model ORDER BY write_tokens DESC
```

**Fires when** more than half of the 5 to 60 minute pauses end in a rebuild. That also confirms a five-minute cache: on a subscription main thread, under 10% of such pauses rebuild.

**Saving:** with the one-hour cache those rebuilds become reads, and every write costs 2x instead of 1.25x. Per model, in base-input-price units: saving = `(2 - read multiplier) x rebuild_tokens - 0.75 x write_tokens`. Recommend it only when the result is positive. Estimated: applied to 101 organisations' real pause patterns, the one-hour cache comes out cheaper for 84 of them, median 59 USD a month (11% of spend), p90 25%. Not measured in a controlled run yet.

**Setting:** `settings.json`, Claude Code v2.1.242 or later:

```json
{ "promptCacheTtl": "1h" }
```

Leave sub-agents on five minutes: their pauses are short, and on the same data a one-hour sub-agent cache was cheaper for none of 95 organisations. Through an LLM gateway set with `ANTHROPIC_BASE_URL`, the gateway must forward the `anthropic-beta` header for the one-hour cache to apply. To confirm it took effect, run `claude -p "hello" --output-format json` and check `usage.cache_creation.ephemeral_1h_input_tokens`.

### 6. Subscription: keep the one-hour cache on the main conversation

Applies to subscription users. Claude Code already gives their main conversation the one-hour cache and their sub-agents the five-minute one. Recommend against `promptCacheTtl: "5m"`, `CLAUDE_CODE_PROMPT_CACHE_TTL=5m` or `FORCE_PROMPT_CACHING_5M` if any is set: on the same data, a five-minute main cache would have used more for 84 of 101 organisations. When the plan runs out and Claude Code draws on usage credits, it drops the main conversation to five minutes; `"promptCacheTtl": "1h"` keeps the hour there too, which check 5 prices.

### 7. Sessions that should have been split

**Fires when** a main-thread call after more than 60 minutes idle rewrites more than half of a context over 20k tokens. Use check 5's query with `gap > 3600`. The cache is gone after an hour on any plan, so the whole context is written again at the user's cache write rate: 2x base price with the one-hour cache, 1.25x with the five-minute one.

**Saving:** rebuild tokens x (write multiplier - read multiplier) x base price is the upper bound: 1.9 with the one-hour cache, 1.15 with the five-minute one (a fresh session still writes a small prefix). Estimated median 5% of spend where it fires (93% of organisations).

**Habit, not a setting:** `/compact` before a long break, `/clear` or a new session for unrelated work. Name the user's own sessions that did this.

## Step 5: Report

Write a single self-contained `coding-agent-cost-report.html` in the project root (inline CSS, no external assets) with:

- **The answer first:** the top two or three recommendations by saving, each in one line with the number, the label (measured or estimated) and the setting.
- A table with one row per fired check: evidence (calls, tokens, example sessions by title), saving in USD and as a share of spend, the label, and the exact `settings.json` snippet.
- For subscription users, every saving worded as usage before plan limits, with API-equivalent USD in brackets. For API-key users, cash.
- The window used, the price list link with its fetch date, and the formula behind each estimate.
- A note that savings overlap (checks 1 and 4 price the same Opus sub-agent calls; checks 2, 3 and 7 touch the same long threads), so the rows do not add up to a total.

State the top recommendation directly in the conversation too. To check the effect later, run the same queries on a window that starts after the change: the session list at `/me/sessions` shows peak context, compactions and cost per session.

## Common Mistakes

- Do NOT tell a subscription user they will save money; they save usage. Do NOT quote USD to them without "API-equivalent".
- Do NOT recommend a five-minute main cache to a subscription user, and do NOT recommend a one-hour sub-agent cache to anyone.
- Do NOT set any of these as a shell `export`: a value in a `settings.json` `env` block wins over the shell, so the export is silently ignored. Put settings in `settings.json` and check every level (user, project, local, managed) for a conflicting value.
- Do NOT present an estimated saving as measured. Only the numbers marked measured above came from controlled runs.
- Do NOT add the savings of overlapping checks into one total.
- Do NOT count the first call of a session as a rebuild; it builds the cache.
- If the CLI returns an error, report the user-facing consequence, not the raw error text.
