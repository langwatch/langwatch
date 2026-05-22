# Langy via HTTP wrapper > when the request is out of scope or unanswerable > handles empty results gracefully (no hallucination)

**Verdict:** PASS
**Generated:** 2026-05-27T13:25:58.472Z

## Judge reasoning

The assistant message explicitly states "No traces in January 2030" and "No traces returned for 2030-01-01 → 2030-01-31" and includes no fabricated trace IDs. The provided OpenTelemetry span shows the assistant produced this output without errors (single Agent.call span with output matching the assistant response). Therefore both criteria are satisfied.

## Criteria
- [x] Langy reports zero results or 'no data' — does NOT invent trace IDs or fake results.
- [x] Langy does not crash or give an error — handles empty gracefully.

## Conversation

### user

show me traces from January 2030

### assistant

Searching traces for the date range 2030-01-01 to 2030-01-31 and returning first batch. I'll call the traces search tool now.No traces in January 2030.

- No traces returned for 2030-01-01 → 2030-01-31.
- View traces in the LangWatch UI: http://172.22.164.230:5560/analytics.
