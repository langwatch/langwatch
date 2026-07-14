# ADR-041: A coding-agent session projection

- Status: Proposed
- Date: 2026-07-11
- Related: ADR-034 (analytics fact tables), PR #5708 (Claude Code enhanced telemetry)

## Context

A coding agent's telemetry does not fit the shape LangWatch models a trace in.

**A trace is the whole session, not a turn.** Claude Code's native tracer groups
an entire session under one `traceId`. Measured against real data on this branch:

> one real session = **796 spans, 34 model calls, 192 tool runs, 2 sub-agents**

And `claude_code.interaction` — the per-prompt root span we might have used to
split it — is emitted **3 times across every trace in 30 days**. It is not a
reliable seam. So the unit we actually have is the **session**.

**The interesting facts are split across signals.** The structure is in the
spans (`llm_request`, `tool`, `tool.execution`, `subagent.spawn`); the content
and half the story are in the logs (the user's prompt, the assistant's reply, the
authoritative cost, a tool the user DENIED, an API error and its retries, a
mid-session context compaction). Neither signal alone describes the session, and
a tool that was denied produces no span at all — it exists only as a log.

**Everything currently recomputes it.** The drawer joins logs onto spans on every
open. The trace summary carries a partial rollup in its attribute map. If the CLI
and the MCP server want the same facts — and they do — each would join it again,
from scratch, per request. `api_request_body` rows run to 60 KB; the join is not
free, and three consumers doing it three ways will drift.

We considered *not* building this ([earlier position in #5708]): the spans plus a
read-time join already produce the drawer's data, and a bespoke table risks
becoming a second source of truth. That reasoning holds for **one** consumer. It
does not survive **three** — an app, a CLI and an MCP server all needing the same
derived view is exactly what a projection is for.

## Decision

Add a **coding-agent session projection**: an event-sourced fold over the trace
pipeline's spans and logs that writes one row per session into a new ClickHouse
table, `coding_agent_sessions`.

It is **agent-generic**. The columns describe things every coding agent has — a
finish reason, tools, sub-agents, skills, an approval mode, context compaction,
retries. What is agent-specific is only *where we read them from*: the span and
event names. Those live in a small **adapter** (Claude Code is the first; Codex
and OpenCode plug in beside it) and every consumer reads the same columns without
knowing which agent produced the session. This mirrors the `langwatch.code_agent.*`
namespace and the `langwatch.gen_ai.*` ingest derivation already on this branch:
**generic keys, pluggable readers.**

The row carries, per session:

- **Identity** — agent, version, session id, user, working directory, model(s).
- **Shape** — model calls, tool calls, sub-agents, and the ordered step sequence
  (batched runs, failures marked in place).
- **Work** — tools used and how often, per-tool duration, files touched, skills
  activated, sub-agent types, slash commands, **MCP servers and MCP tools used**.
- **Economics** — input/output tokens, **cache reads vs. cache creation** (the
  expensive mistake for a coding agent is cache invalidation, not raw tokens),
  and the authoritative cost.
- **What went wrong** — failed tools, API errors, **rate limits (429)**, retries
  exhausted, refusals.
- **What the human did** — **tools denied**, **tools aborted**, the approval mode
  the session ran under.
- **What the agent did to itself** — context compactions, and the tokens before
  and after each.
- **How it ended** — stop reason, and whether the final reply was **truncated**
  rather than finished (a reply cut off by `max_tokens` is not an answer, but
  rendered as the session's output it reads exactly like one).

## Consequences

**Good.** Computed once, at write time; reads are a single keyed row. The app's
session overview, the CLI and the MCP server all serve the same numbers, so they
cannot drift. The data becomes *queryable* — "which MCP servers does this project
actually use", "how often do we deny a tool", "what fraction of spend is
cache re-creation" become ordinary SQL rather than a per-trace join.

**Cost.** A second write path and a second table to keep correct. A re-fold is
needed when the derivation changes (the projection is versioned, like its
siblings). The row is a rollup, not a substitute for the spans — the Terminal
still reads spans, because a replay needs the actual transcript.

**Bounded.** The fold state must stay O(1) in span count, like the trace-summary
fold: the ordered step list is capped, the file list is capped, and nothing else
scales with the session's length. This is the same invariant that made removing
`MAX_PROCESSED_SPANS` safe, and it is the invariant that keeps a 20,000-span
session from growing the fold unboundedly.

## Known limitation: metrics never reach a per-trace fold

Verified against 30 days of live data: **every Claude Code metric arrives with an
empty `TraceId`** (1,867 of 1,867). The metrics are SESSION-scoped, not
trace-scoped — the agent reports `lines_of_code.count`, `commit.count`,
`pull_request.count`, `code_edit_tool.decision` and `active_time.total` against
`session.id`, with no trace to hang them on.

This fold is keyed by `traceId`, so those records can never be routed to it. The
metric-folding code in the derivation is therefore correct but **unreachable**,
and the corresponding row fields (`linesAdded`, `linesRemoved`, `commits`,
`pullRequests`, `editsAccepted`, `editsRejected`, `activeTime*`) are always zero.
The UI hides them at zero, so it does not lie — but it cannot report them either.

Fixing it means keying the outcome rollup on `session.id` rather than `traceId`
(either a second projection, or a session-keyed sibling table joined at read
time). That is a design change, not a patch, and is deliberately left out of this
ADR rather than shipped as a stat block that silently always reads zero.

The same shape explains why `mcp_server_connection` logs cannot feed this fold:
they land on a session's STARTUP trace, which contains no model calls and no tool
runs, so no session row is written for it at all. MCP usage is instead derived
from the tool NAME (`mcp__<server>__<tool>`), which is the signal that actually
arrives inside the working trace.

## Alternatives considered

- **Keep joining at read time.** Rejected: three consumers, three joins, guaranteed
  drift, and 60 KB bodies re-parsed per request.
- **Widen `trace_summaries`.** Rejected: it is the generic trace rollup that every
  emitter shares. Coding-agent columns there are dead weight for everyone else,
  and the attribute-map rollup already on this branch is at the limit of what a
  string map should carry.
- **A Claude-Code-specific table.** Rejected: the facts are not Claude-specific,
  and a `claude_code_sessions` table would have to be duplicated the day Codex
  matters.
