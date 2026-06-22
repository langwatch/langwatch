# Langy via HTTP wrapper > when user requests read-only listings > lists triggers

**Verdict:** PASS
**Generated:** 2026-05-27T13:08:18.534Z

## Judge reasoning

The assistant response in the transcript explicitly reports a trigger count and details: "3 triggers... - All 3 are active and set to CRITICAL..." satisfying criterion 1. The response does not mention monitors or evaluators or pivot to them; it only lists action types (SEND_SLACK_MESSAGE, ADD_TO_ANNOTATION_QUEUE) and a URL, satisfying criterion 2.

## Criteria
- [x] Langy reports trigger count or a clear empty state.
- [x] Langy doesn't pivot to monitors or evaluators.

## Conversation

### user

show me my alert triggers

### assistant

3 triggers.

- All 3 are active and set to CRITICAL.
- Two use SEND_SLACK_MESSAGE (IDs: C1NsW6Lp5sFFoVQq55Hux, qIg02aOwqDuLdwVF4gviK); one uses ADD_TO_ANNOTATION_QUEUE (ID: k_JrILJgDrvAaX-wMteV0).

http://172.22.164.230:5560/triggers
