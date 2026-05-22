# Langy via HTTP wrapper > when user asks about analytics or traces > returns p95 latency

**Verdict:** PASS
**Generated:** 2026-05-27T13:01:00.393Z

## Judge reasoning

The transcript shows the assistant responded with an explicit p95 latency value: "p95 latency (last 24h): 15,229 ms" and labeled it as p95. There is no mention of average or conflation with mean; the assistant specifically addressed p95. Both criteria are therefore satisfied.

## Criteria
- [x] Langy returns a p95 latency figure or 'no data'.
- [x] Langy does not confuse p95 with average — it specifically addressed p95.

## Conversation

### user

what is my p95 latency?

### assistant

Querying p95 latency for the last 24 hours.- p95 latency (last 24h): 15,229 ms  
- Unit inferred as milliseconds (using performance.completion_time)
