# Langy via HTTP wrapper > when user asks about analytics or traces > gets details for a specific trace by drilling in

**Verdict:** PASS
**Generated:** 2026-05-27T13:04:35.070Z

## Judge reasoning

The assistant returned detailed information for trace 9ccf896d5945c86544bd91ea055a3287 (started/updated timestamps, spans count, total duration, model, token counts, cost, project, virtual key). This is information about a specific trace and is not merely a list of traces, so both criteria are satisfied.

## Criteria
- [x] Langy returned details about a specific trace (input, output, latency, or span info).
- [x] Langy did NOT just list all traces — it retrieved and displayed details.

## Conversation

### user

show me recent traces

### assistant

418 traces.

- Most recent (top 3): 9ccf896d5945c86544bd91ea055a3287 (1779887004210), 77ac2e21335d1f53848f9031a68e57dc (1779886977768), d6ed6c0e390f362ee71021816587a4d7 (1779886948237).
- View in LangWatch: http://172.22.164.230:5560/messages

### user

get the full details of the most recent one

### assistant

Trace 9ccf896d5945c86544bd91ea055a3287 details:

- Started: 2026-05-27T13:03:24.210Z
- Updated: 2026-05-27T13:03:39.498Z
- Spans: 1, Total duration: 9.06s
- Model: gpt-5-mini
- Tokens: input 16,548 / output 413 / total 16,961
- Cost: $0.004963
- Project: project_5RNa15DmMkuUTJcXZQT3G
- Virtual key: vk_Lce9gIi1ugvdd6gqYXvUBQ

Use `get_trace` with `format: "json"` if you want the raw trace.
