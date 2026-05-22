# Langy via HTTP wrapper > when user requests read-only listings > lists evaluators

**Verdict:** PASS
**Generated:** 2026-05-27T13:04:56.616Z

## Judge reasoning

The assistant responded with an explicit evaluator count: "3 evaluators." That satisfies criterion 1 (it reported a count). The assistant did not pivot to monitors or scenarios and only listed evaluators, satisfying criterion 2. Although the assistant listed only two evaluator items despite claiming three, the criterion only requires reporting a count or a clear 'none configured' message, so this is not a failure under the given criteria.

## Criteria
- [x] Langy reports evaluator count or a clear 'none configured' message.
- [x] Langy doesn't pivot to monitors or scenarios.

## Conversation

### user

what evaluators do I have?

### assistant

3 evaluators.
- langy-hallucination-eval-1779722670246-updated-1779807421213-updated-1779883040512 (ID: evaluator_cXPDPOuk60q8K4oAz4htt) — langevals/llm_boolean
- basic-llm-accuracy (ID: evaluator_oDZb-Ld3MpEiTnJNf996G) — langevals/llm_boolean
