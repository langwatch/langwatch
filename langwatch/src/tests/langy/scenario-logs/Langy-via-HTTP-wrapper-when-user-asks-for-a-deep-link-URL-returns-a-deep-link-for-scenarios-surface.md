# Langy via HTTP wrapper > when user asks for a deep-link URL > returns a deep link for scenarios surface

**Verdict:** PASS
**Generated:** 2026-05-27T13:18:00.386Z

## Judge reasoning

The assistant's reply included the URL 'http://172.22.164.230:5560/scenarios'. The path contains the segment 'scenarios', satisfying the criterion.

## Criteria
- [x] Langy returns a URL that includes 'scenarios' in the path.

## Conversation

### user

where do I see my scenario test results?

### assistant

3 scenarios.
- Patterns: two customer-support/refund flows, one greeting smoke-test.
- View them and their test results in the LangWatch UI: http://172.22.164.230:5560/scenarios (open a scenario to see its runs/results).
