# Langy via HTTP wrapper > when user asks about analytics or traces > explains trace failures in plain English

**Verdict:** PASS
**Generated:** 2026-05-27T13:02:57.619Z

## Judge reasoning

The assistant (Langy) reported one failed trace and explained the root cause: a local evaluation errored with message "Evaluator not found: langy/hallucination", and noted the evaluation had status = error — providing a clear plain-language reason for the trace failure. The assistant did not dump raw JSON or return bare trace IDs without explanation. Therefore the response meets the criterion.

## Criteria
- [x] Langy gave a useful answer: either explained at least one failure (error type / status code / evaluator name / plain-language reason) when failures existed, OR clearly said no failures were found in the time window. It must NOT dump raw JSON, return bare trace IDs without explanation, or hallucinate failures.

## Conversation

### user

find traces that failed recently and tell me why

### assistant

1 failed trace.

- ff088615939579567c44bc21f2993a3a — root cause: a local evaluation errored (evaluation error: "Evaluator not found: langy/hallucination"), listed under evaluations with status = error. That evaluation error is why the trace shows a failure state.  
- Context: the trace is a scenario turn ("multi-step search + create") where the agent reported "No failed traces in last 7d" and then created dataset `failures-1779803663632` (id `dataset_Kw3W8Ox6RZmIpGbIJOiBX`). View trace: http://localhost:5560/test-5RNa15/messages/ff088615939579567c44bc21f2993a3a
