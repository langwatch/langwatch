# ADR-009: OTEL Trace Context Propagation for HTTP Scenario Targets

**Date:** 2026-02-25

**Status:** Accepted

## Context

When scenarios call HTTP agent endpoints on the platform, the judge has no visibility into what happened inside the user's agent (LLM calls, tool calls, etc.). This prevents evaluation of tool call behavior.

For SDK-based (local) runs, `JudgeSpanCollector` collects spans in-memory because the agent-under-test runs in the same process. For HTTP targets, the user's spans are generated in a separate service, exported via their own OTEL pipeline, and stored in LangWatch's span storage. The judge is blind.

```
Platform gap (before this ADR):

LangWatch Child Process          User's Service
┌────────────────────┐           ┌────────────────────┐
│ HTTP Adapter  ────────────────►│ LangWatch SDK      │
│      ↓             │           │      ↓             │
│ Judge (no spans!)  │           │ Spans → Storage    │
└────────────────────┘           └────────────────────┘
```

The core challenge is timing: spans arrive asynchronously. The user's OTEL SDK batches spans (typically 5s intervals), exports them to LangWatch's collector, and the storage backend indexes them. By the time the judge runs, spans may or may not have arrived.

## What we considered

**Option A: In-process span collection via OTEL exporter.**
Route the user's spans directly to the child process via a custom OTEL exporter endpoint. Avoids the storage backend entirely. Rejected because it requires SDK changes, a new network endpoint per child process, and breaks the existing architecture where the child process is a short-lived fire-and-forget process.

**Option B: W3C Trace Context + query platform API at judge time (chosen).**
Propagate `traceparent` headers so the user's spans link to our trace. Query the platform API for those spans before the judge evaluates. Simple, no SDK changes for header propagation, uses existing infrastructure.

**Option C: Streaming span collection via gRPC/WebSocket.**
The user's service streams spans back to the child process in real-time. Rejected as over-engineered — requires new protocol, SDK changes, and connection management for short-lived processes.

## Decision

We will propagate W3C trace context headers in HTTP adapter requests and query the platform API for linked spans before judge evaluation.

### Header injection

Both `HttpAgentAdapter` (direct execution) and `SerializedHttpAgentAdapter` (child process) will inject two headers on every outbound request:

- **`traceparent`**: Standard W3C trace context header, propagated from the active OTEL context using `@opentelemetry/api` propagation. The child process's own TracerProvider supplies the trace ID, which remains consistent across all turns of a conversation.
- **`x-langwatch-scenario-run`**: LangWatch-specific correlation header containing the batch run ID. Enables platform-level correlation independent of OTEL.

When no active OTEL context exists, requests proceed without trace headers — no error thrown.

### Trace ID capture

The trace ID is captured explicitly during HTTP adapter calls (when `injectTraceContextHeaders` is invoked) and stored on the adapter instance. After the conversation completes, the trace ID is read from the adapter and passed to `RemoteSpanJudgeAgent.setTraceId()` before judge evaluation. This avoids relying on ambient OTEL context at judge time, which would be fragile since the judge may run in a different span context than the adapter.

### Remote span collection

After the conversation completes and before judge evaluation, the system queries the platform API for spans matching the propagated trace ID. Because spans arrive asynchronously:

- The query retries with backoff within a configurable timeout (default 10s).
- Infrastructure spans (user simulator LLM calls, judge LLM calls) are filtered out — only user agent spans are returned.
- If no spans are found after retries, the span collector is populated with an empty set.
- If the span query fails, a synthetic error span (`langwatch.span_collection.error`) is created with the failure reason, so the judge sees the infrastructure problem in its digest.

### Judge integration

The `@langwatch/scenario` SDK's `judgeAgent({ spanCollector })` already accepts a `JudgeSpanCollector` instance. We create a remote implementation (`RemoteSpanJudgeAgent`) that pre-populates spans from the platform API query. The `JudgeSpanDigestFormatter` renders these spans into the judge's prompt as `<opentelemetry_traces>`.

### Graceful degradation

Empty spans are not an error. The judge evaluates what it has. If criteria reference tool calls and no spans exist, the judge fails those criteria naturally — no special warning infrastructure needed. The judge is trusted to handle this correctly.

Span query failures are different: they represent infrastructure problems. The synthetic error span ensures this is visible in the judge's digest and reasoning.

## Consequences

**Positive:**
- Judge can evaluate tool call behavior for HTTP targets without SDK changes
- No impact on conversation speed — delay only at judgment time
- Works with any OTEL-compatible SDK on the user's side
- Graceful degradation — scenarios never fail solely due to missing spans
- Uses existing platform API and `JudgeSpanCollector` interface

**Negative:**
- Span collection adds latency before judge evaluation (up to timeout window)
- Timing is inherently best-effort — spans that arrive after the timeout are missed by the judge (still visible in UI traces)
- Reconstructing `ReadableSpan` objects from stored span documents requires an adapter layer

**Neutral:**
- The `@langwatch/scenario` SDK does not need changes for this feature
- Users must have an OTEL-compatible SDK integrated for tool call evaluation to work

## References

- Feature spec: `langwatch/specs/scenarios/otel-trace-context-propagation.feature`
- GitHub issue: #1325
- Related: #1088 (worker isolation for server-side targets — separate concern)
- Related: #1264 (original spike issue)
- Related: [ADR-008: Extensible Metadata on Scenario Events](008-extensible-metadata-on-scenario-events.md)
