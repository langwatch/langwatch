-- +goose Up
-- +goose ENVSUB ON

-- One row per coding-agent session event: a model API call, a compaction, a
-- rate limit, an API error, a tool run, a prompt, a sub-agent completion.
-- Fed by a map projection over the coding-agent pipeline's contribution
-- stream (ADR-056), so it is replayable over stored history (ADR-015).
--
-- This is the per-call fact table the session aggregate cannot be: one
-- ordered scan per session yields the interleaved sequence (calls between
-- compactions, tool mix around a rate limit, cumulative cost curves) that
-- `coding_agent_sessions`' converged totals erase by design.
--
-- Typed scalar columns only, deliberately no free-form attributes map: the
-- wire rides user identity (user.email, user.id, account ids) on nearly
-- every event, and content stays in the canonical span/log rows. Anything
-- not typed here stays reachable via RecordId -> log_records.
-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.coding_agent_session_events
(
    TenantId String CODEC(ZSTD(1)),
    SessionId String CODEC(ZSTD(1)),
    TimeUnixMs DateTime64(3) CODEC(Delta(8), ZSTD(1)),
    -- The canonical log record's content hash: the dedup identity. The same
    -- wire record re-dispatched or replayed lands on the same key and the
    -- ReplacingMergeTree collapses it.
    RecordId FixedString(64) CODEC(ZSTD(1)),

    EventKind LowCardinality(String) CODEC(ZSTD(1)),
    Agent LowCardinality(String) CODEC(ZSTD(1)),
    SessionKeySource LowCardinality(String) CODEC(ZSTD(1)),

    -- '' when the record resolved no correlation.
    TraceId String CODEC(ZSTD(1)),
    SpanId String CODEC(ZSTD(1)),
    -- The per-prompt (turn) id when the agent emits one; '' otherwise.
    PromptId String CODEC(ZSTD(1)),
    -- Who issued the call: repl_main_thread | sdk | agent:builtin:<type> |
    -- utility sources (quota, generate_session_title, ...). The per-call
    -- sub-agent attribution signal.
    QuerySource LowCardinality(String) CODEC(ZSTD(1)),
    -- Sub-agent type when the event carries one (agent_type/subagent_type or
    -- parsed off an agent:* query source).
    AgentType LowCardinality(String) CODEC(ZSTD(1)),
    -- In-session ordering tie-break within one TimeUnixMs; -1 when absent.
    EventSequence Int64 CODEC(Delta(8), ZSTD(1)),

    -- model_call
    RequestId String CODEC(ZSTD(1)),
    Model LowCardinality(String) CODEC(ZSTD(1)),
    InputTokens UInt64 CODEC(ZSTD(1)),
    OutputTokens UInt64 CODEC(ZSTD(1)),
    CacheReadTokens UInt64 CODEC(ZSTD(1)),
    CacheCreationTokens UInt64 CODEC(ZSTD(1)),
    CostUsd Float64 CODEC(ZSTD(1)),
    DurationMs UInt32 CODEC(ZSTD(1)),
    TtftMs UInt32 CODEC(ZSTD(1)),
    Attempt UInt16 CODEC(ZSTD(1)),
    Speed LowCardinality(String) CODEC(ZSTD(1)),
    StopReason LowCardinality(String) CODEC(ZSTD(1)),

    -- compaction
    PreTokens UInt64 CODEC(ZSTD(1)),
    PostTokens UInt64 CODEC(ZSTD(1)),
    CompactionTrigger LowCardinality(String) CODEC(ZSTD(1)),
    PrecomputeReuse LowCardinality(String) CODEC(ZSTD(1)),

    -- api_error / rate_limit / retries_exhausted
    StatusCode LowCardinality(String) CODEC(ZSTD(1)),
    ErrorType LowCardinality(String) CODEC(ZSTD(1)),
    -- which of the two rate-limit carriers reported it: `event` (a limit
    -- engaging) or `info` (a status update), not the limited dimension
    RateLimitCarrier LowCardinality(String) CODEC(ZSTD(1)),
    RetryDurationMs UInt64 CODEC(ZSTD(1)),

    -- tool_result / tool_decision (Success is stringly on the wire and also
    -- carries the compaction event's success flag)
    ToolName LowCardinality(String) CODEC(ZSTD(1)),
    Success LowCardinality(String) CODEC(ZSTD(1)),
    Decision LowCardinality(String) CODEC(ZSTD(1)),
    DecisionSource LowCardinality(String) CODEC(ZSTD(1)),
    ToolInputBytes UInt64 CODEC(ZSTD(1)),
    ToolResultBytes UInt64 CODEC(ZSTD(1)),

    -- user_prompt
    PromptChars UInt32 CODEC(ZSTD(1)),

    -- subagent_completed
    TotalTokens UInt64 CODEC(ZSTD(1)),

    UpdatedAt DateTime64(3) DEFAULT now64(3) CODEC(Delta(8), ZSTD(1)),
    `_retention_days` UInt16 DEFAULT 308 CODEC(Delta(2), ZSTD(1)),

    INDEX idx_case_event_kind EventKind TYPE set(16) GRANULARITY 4,
    INDEX idx_case_request_id RequestId TYPE bloom_filter(0.001) GRANULARITY 1
)
ENGINE = ${CLICKHOUSE_ENGINE_REPLACING_PREFIX:-ReplacingMergeTree(}UpdatedAt)
PARTITION BY toYearWeek(TimeUnixMs)
ORDER BY (TenantId, SessionId, TimeUnixMs, RecordId)
TTL IF(_retention_days > 0, toDateTime(TimeUnixMs) + toIntervalDay(_retention_days), toDateTime('2106-01-01')) DELETE
SETTINGS index_granularity = 8192${CLICKHOUSE_STORAGE_POLICY_SETTING};
-- +goose StatementEnd

-- +goose Down
-- To roll back, uncomment and run manually:
-- DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.coding_agent_session_events;
