-- +goose Up
-- +goose ENVSUB ON

-- ============================================================================
-- coding_agent_sessions — ADR-041.
--
-- One row per coding-agent SESSION, folded from that session's spans, logs AND
-- metrics. A fold projection writes it (latest version wins) into a
-- ReplacingMergeTree(UpdatedAt), exactly like trace_summaries / trace_analytics.
--
-- Why a table at all, when the spans already hold everything:
--   The app, the CLI and the MCP server all want the same derived facts. Three
--   consumers re-joining 60 KB API bodies per request is three chances to drift
--   and three times the cost. Derive once, at write time; read a single keyed
--   row.
--
-- Why one row per SESSION and not per turn:
--   Claude Code's native tracer groups a whole session under one traceId — a
--   real session measured 796 spans / 34 model calls / 192 tool runs — and the
--   per-prompt `claude_code.interaction` span it might have been split on is
--   emitted 3 times across EVERY trace in 30 days. It is not a seam we can rely
--   on. So TraceId IS the session key.
--
-- Why the columns are agent-generic:
--   Every coding agent has a finish reason, tools, sub-agents, an approval mode,
--   retries, context compaction. Only WHERE those are read from is
--   agent-specific, and that lives in an adapter in the derivation. Claude Code
--   is the first; a Codex adapter writes the same columns and every consumer
--   keeps working.
--
-- LIGHT BY DESIGN — this is an AGGREGATE, NOT A COPY:
--   No prompts, no replies, no raw bodies, no tool output. Those already live in
--   stored_spans / log records / the blob store, and duplicating them here would
--   double the storage for no gain and immediately risk drifting from the
--   source. Instead the row carries IDS THAT REACH THE HEAVY DATA:
--     TraceId        → the spans and the log records for this session
--     SessionId      → the agent's own session id (the rest of the run)
--     FinalRequestId → the exact response body that ENDED the session
--   Text is MEASURED (PromptChars / ResponseChars), never carried.
--
-- BOUNDED BY DESIGN: every column is a scalar, a bounded array, or a small map
-- keyed by a low-cardinality name (a tool, a model, an error class). Nothing
-- grows with the length of the session — the same invariant that let us delete
-- MAX_PROCESSED_SPANS, pinned by a test that folds 20,000 spans.
--
-- Engine / partition / retention mirror trace_summaries so partitions age and
-- roll off identically.
--   * ReplacingMergeTree(UpdatedAt) — re-folds are replay-safe. The engine only
--     collapses rows sharing the FULL sort key, and StartedAt can shift when an
--     earlier span arrives late, so every read MUST dedup by
--     (TenantId, TraceId, max(UpdatedAt)) — the IN-tuple pattern, never FINAL.
--   * ORDER BY (TenantId, StartedAt, TraceId) — TIME-LEADING. The reads this
--     table exists for are time-bounded scans ("what did this project's agents
--     do this week", "how much is cache re-creation costing us"), not per-trace
--     point lookups; the drawer's single-session read is a cheap seek within one
--     partition. Always filter StartedAt — it is the partition key.
-- ============================================================================

-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.coding_agent_sessions
(
    TenantId String CODEC(ZSTD(1)),
    -- The session key. A coding-agent trace IS the session.
    TraceId String CODEC(ZSTD(1)),
    -- Schema-snapshot identifier (calendar date). NOT the LWW key: CH rejects
    -- LowCardinality(String) as a ReplacingMergeTree version column.
    Version LowCardinality(String) CODEC(ZSTD(1)),

    StartedAt DateTime64(3) CODEC(Delta(8), ZSTD(1)),
    CreatedAt DateTime64(3) DEFAULT now64(3) CODEC(Delta(8), ZSTD(1)),
    UpdatedAt DateTime64(3) DEFAULT now64(3) CODEC(Delta(8), ZSTD(1)),

    -- ── Identity, and the ids that reach the heavy data ───────────────────
    -- Which agent produced this. `claude_code` today; the column is generic.
    Agent LowCardinality(String) CODEC(ZSTD(1)),
    AgentVersion LowCardinality(String) CODEC(ZSTD(1)),
    -- The agent's own session id: reaches the other traces of the same run.
    SessionId String CODEC(ZSTD(1)),
    -- The request id of the LAST model call — the pointer to the response body
    -- that actually ended the session, without carrying a byte of it.
    FinalRequestId String CODEC(ZSTD(1)),
    UserId String CODEC(ZSTD(1)),
    TerminalType LowCardinality(String) CODEC(ZSTD(1)),
    Entrypoint LowCardinality(String) CODEC(ZSTD(1)),

    -- ── Shape ─────────────────────────────────────────────────────────────
    ModelCalls UInt32 CODEC(ZSTD(1)),
    ToolCalls UInt32 CODEC(ZSTD(1)),
    SubAgents UInt32 CODEC(ZSTD(1)),
    Prompts UInt32 CODEC(ZSTD(1)),
    -- Text is MEASURED, never carried.
    PromptChars UInt64 CODEC(ZSTD(1)),
    ResponseChars UInt64 CODEC(ZSTD(1)),
    -- The steps in the order they happened, batched, failures marked in place.
    -- Bounded (100). `(name, count, failed)`.
    Steps Array(Tuple(String, UInt32, Bool)) CODEC(ZSTD(1)),

    -- ── Work ──────────────────────────────────────────────────────────────
    ToolCounts Map(LowCardinality(String), UInt32) CODEC(ZSTD(1)),
    ToolDurationMs Map(LowCardinality(String), UInt64) CODEC(ZSTD(1)),
    FilesTouched Array(String) CODEC(ZSTD(1)),
    Skills Array(LowCardinality(String)) CODEC(ZSTD(1)),
    SubAgentTypes Array(LowCardinality(String)) CODEC(ZSTD(1)),
    SlashCommands Array(LowCardinality(String)) CODEC(ZSTD(1)),
    Models Array(LowCardinality(String)) CODEC(ZSTD(1)),
    McpServers Array(LowCardinality(String)) CODEC(ZSTD(1)),
    McpTools Array(LowCardinality(String)) CODEC(ZSTD(1)),

    -- ── Economics ─────────────────────────────────────────────────────────
    InputTokens UInt64 CODEC(ZSTD(1)),
    OutputTokens UInt64 CODEC(ZSTD(1)),
    CacheReadTokens UInt64 CODEC(ZSTD(1)),
    -- The expensive mistake. A cache READ is billed at a fraction of fresh
    -- input; a cache WRITE costs more than it. A session that keeps re-creating
    -- its cache burns money in a way raw token counts do not show.
    CacheCreationTokens UInt64 CODEC(ZSTD(1)),
    CostUsd Float64 CODEC(ZSTD(1)),

    -- ── Time ──────────────────────────────────────────────────────────────
    ModelCallMs UInt64 CODEC(ZSTD(1)),
    ToolMs UInt64 CODEC(ZSTD(1)),
    -- Sum + count, so the mean survives a fold (a running average cannot).
    TtftMsTotal UInt64 CODEC(ZSTD(1)),
    TtftSamples UInt32 CODEC(ZSTD(1)),
    -- How long a HUMAN sat waiting to approve a tool. Agent idle, person idle:
    -- the one duration in the session that is pure friction.
    BlockedOnUserMs UInt64 CODEC(ZSTD(1)),
    ActiveTimeUserSec UInt64 CODEC(ZSTD(1)),
    ActiveTimeCliSec UInt64 CODEC(ZSTD(1)),

    -- ── Context pressure ──────────────────────────────────────────────────
    -- Tool OUTPUT fed back into the context: the usual cause of a session
    -- bloating its way into a compaction.
    ToolResultBytes UInt64 CODEC(ZSTD(1)),
    ToolInputBytes UInt64 CODEC(ZSTD(1)),
    Compactions UInt32 CODEC(ZSTD(1)),
    CompactionTokensBefore UInt64 CODEC(ZSTD(1)),
    CompactionTokensAfter UInt64 CODEC(ZSTD(1)),
    -- The biggest SINGLE call's context (CacheRead + CacheCreation for that
    -- one call) — how big the context window got, at its worst. Distinct
    -- from CacheReadTokens/CacheCreationTokens above, which are cumulative
    -- sums across every call and answer a cost question, not this one.
    PeakContextTokens UInt64 CODEC(ZSTD(1)),
    -- How many calls re-created most of the context instead of reading it
    -- from cache. Same threshold sessionView/tokenTimeline.ts's
    -- findCacheRebuilds uses client-side.
    CacheRebuildCount UInt32 CODEC(ZSTD(1)),
    -- The single worst rebuild's CacheCreationTokens.
    LargestCacheRebuildTokens UInt64 CODEC(ZSTD(1)),

    -- ── What went wrong ───────────────────────────────────────────────────
    FailedTools UInt32 CODEC(ZSTD(1)),
    -- Failure classes, e.g. {'Error:ENOENT': 3, 'ShellError': 1}.
    ErrorTypes Map(LowCardinality(String), UInt32) CODEC(ZSTD(1)),
    ApiErrors UInt32 CODEC(ZSTD(1)),
    RateLimited UInt32 CODEC(ZSTD(1)),
    RetriesExhausted UInt32 CODEC(ZSTD(1)),
    RetryMs UInt64 CODEC(ZSTD(1)),
    Attempts UInt32 CODEC(ZSTD(1)),
    Refusals UInt32 CODEC(ZSTD(1)),
    RefusalCategories Array(LowCardinality(String)) CODEC(ZSTD(1)),
    InternalErrors UInt32 CODEC(ZSTD(1)),

    -- ── What the human did, and what the guardrails did ────────────────────
    -- A denied tool NEVER RAN, so it has no span at all. Read only the spans and
    -- the agent merely appears to have changed its mind.
    ToolsDenied UInt32 CODEC(ZSTD(1)),
    -- An abort is the human walking away, not a tool that broke.
    ToolsAborted UInt32 CODEC(ZSTD(1)),
    PermissionMode LowCardinality(String) CODEC(ZSTD(1)),
    PermissionChanges UInt32 CODEC(ZSTD(1)),
    -- The safeguards that actually FIRED and stopped the agent doing something.
    HooksBlocked UInt32 CODEC(ZSTD(1)),
    HooksCancelled UInt32 CODEC(ZSTD(1)),
    HookMs UInt64 CODEC(ZSTD(1)),

    -- ── What came out of it ───────────────────────────────────────────────
    -- The only signals that say whether anything CAME of the session. Without
    -- them a summary can say the agent ran 192 tools and not whether it shipped.
    LinesAdded UInt64 CODEC(ZSTD(1)),
    LinesRemoved UInt64 CODEC(ZSTD(1)),
    Commits UInt32 CODEC(ZSTD(1)),
    PullRequests UInt32 CODEC(ZSTD(1)),
    EditsAccepted UInt32 CODEC(ZSTD(1)),
    EditsRejected UInt32 CODEC(ZSTD(1)),
    LanguagesEdited Array(LowCardinality(String)) CODEC(ZSTD(1)),
    AtMentions UInt32 CODEC(ZSTD(1)),

    -- ── How it ended ──────────────────────────────────────────────────────
    StopReason LowCardinality(String) CODEC(ZSTD(1)),
    -- The reply was CUT OFF rather than finished. It is not an answer, but
    -- rendered as the session's output it reads exactly like one.
    Truncated Bool CODEC(ZSTD(1)),

    `_retention_days` UInt16 DEFAULT 308 CODEC(Delta(2), ZSTD(1))
)
ENGINE = ${CLICKHOUSE_ENGINE_REPLACING_PREFIX:-ReplacingMergeTree(}UpdatedAt)
PARTITION BY toYearWeek(StartedAt)
ORDER BY (TenantId, StartedAt, TraceId)
TTL IF(_retention_days > 0, toDateTime(StartedAt) + toIntervalDay(_retention_days), toDateTime('2106-01-01')) DELETE
SETTINGS index_granularity = 8192${CLICKHOUSE_STORAGE_POLICY_SETTING};
-- +goose StatementEnd

-- +goose Down
-- Down migrations are commented out to prevent accidental data loss.
-- To roll back, uncomment and run manually.
-- +goose StatementBegin
-- DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.coding_agent_sessions;
-- +goose StatementEnd
