# Langy via HTTP wrapper > when user asks about analytics or traces > returns latency stats without asking for clarification

**Verdict:** PASS
**Generated:** 2026-05-27T13:00:00.486Z

## Judge reasoning

The assistant in the transcript returned a numeric average latency (6,648.8 ms / ~6.65 s) for the last 24h, did not ask which metric or time range, and stayed on topic without discussing costs or traces. All three success criteria are met.

## Criteria
- [x] Langy returns a latency figure (ms or seconds) or 'no data'.
- [x] Langy does not ask which metric or which time range.
- [x] Langy stays on topic — does not pivot to costs or traces.

## Conversation

### user

what's my average latency?

### assistant

- Average latency (last 24h): 6,648.8 ms (~6.65 s)
- Trend: down from 9,378.4 ms (2026-05-26) to 6,648.8 ms (2026-05-27)
