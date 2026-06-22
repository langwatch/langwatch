# Langy via HTTP wrapper > when user requests read-only listings > lists monitors

**Verdict:** PASS
**Generated:** 2026-05-27T13:07:05.300Z

## Judge reasoning

The transcript shows the assistant responded: "3 monitors. • All are enabled, mode=ON_MESSAGE, sample=100%, and are hallucination-type monitors. • Names & IDs: langy-test-monitor-1779722670246 (U5R8wDFjEiS3uoTzCzimf), langy-test-monitor-1779807328082 (FxYSN71ueQv31B7uFyOIJ), langy-test-monitor-1779882957657 (VfbBGDR_SDGQiQkF1y8Ii)". This explicitly reports a monitor count (criterion 1), stays on-topic with monitors rather than pivoting to evaluators or scenarios (criterion 2), and does not ask the user to clarify the meaning of "monitor" (criterion 3). Therefore the final verdict is success.

## Criteria
- [x] Langy reports monitor count or a clear 'no monitors' message.
- [x] Langy doesn't pivot to evaluators or scenarios — it matched 'monitor'.
- [x] Langy doesn't ask the user to clarify what they mean by monitor.

## Conversation

### user

what monitors do I have set up?

### assistant

3 monitors.
• All are enabled, mode=ON_MESSAGE, sample=100%, and are hallucination-type monitors.
• Names & IDs: langy-test-monitor-1779722670246 (U5R8wDFjEiS3uoTzCzimf), langy-test-monitor-1779807328082 (FxYSN71ueQv31B7uFyOIJ), langy-test-monitor-1779882957657 (VfbBGDR_SDGQiQkF1y8Ii)
