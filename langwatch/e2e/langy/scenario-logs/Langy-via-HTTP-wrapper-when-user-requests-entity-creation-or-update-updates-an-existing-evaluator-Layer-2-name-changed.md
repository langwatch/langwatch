# Langy via HTTP wrapper > when user requests entity creation or update > updates an existing evaluator (Layer 2: name changed)

**Verdict:** PASS
**Generated:** 2026-05-27T13:14:51.041Z

## Judge reasoning

The assistant's response in the transcript explicitly states: "Done — renamed evaluator evaluator_cXPDPOuk60q8K4oAz4htt to langy-hallucination-eval-...-updated-1779887651832." This indicates a successful update. The assistant did not ask the user for confirmation before performing the update; it stated it would call the platform API and then reported completion. Therefore both criteria are satisfied.

## Criteria
- [x] Langy reports successfully updating the evaluator.
- [x] Langy did not ask for confirmation before updating.

## Conversation

### user

rename my evaluator "langy-hallucination-eval-1779722670246-updated-1779807421213-updated-1779883040512" to "langy-hallucination-eval-1779722670246-updated-1779807421213-updated-1779883040512-updated-1779887651832"

### assistant

Renaming evaluator now — I'll call the platform API to update its name.Done — renamed evaluator evaluator_cXPDPOuk60q8K4oAz4htt to langy-hallucination-eval-1779722670246-updated-1779807421213-updated-1779883040512-updated-1779887651832.
