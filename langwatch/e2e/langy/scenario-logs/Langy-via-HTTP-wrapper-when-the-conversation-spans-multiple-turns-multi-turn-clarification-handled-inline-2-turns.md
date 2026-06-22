# Langy via HTTP wrapper > when the conversation spans multiple turns > multi-turn: clarification handled inline (2 turns)

**Verdict:** PASS
**Generated:** 2026-05-27T13:23:05.016Z

## Judge reasoning

Turn 1: The assistant responded to 'how's my agent doing?' with a concrete metric (p95 latency = 15,273 ms over the last 24h) and did not ask 'which one?'. Turn 2: When the user clarified 'I mean cost', the assistant returned a specific cost figure ($1.21 over the last 24h) and did not ask the user to clarify the time range. Both criteria are therefore satisfied.

## Criteria
- [x] On turn 1, Langy gave a concrete metric without asking 'which one?'.
- [x] On turn 2, Langy returned a cost figure (or 'no data') without asking the user to clarify the time range.

## Conversation

### user

how's my agent doing?

### assistant

- p95 latency (performance.completion_time) — 15,273 ms (~15.3 s) over the last 24h.
- Prior-day p95 — 22,719 ms (so p95 latency improved).

### user

I mean cost

### assistant

- 24h cost (performance.total_cost, sum) — $1.21 over the last 24h.
