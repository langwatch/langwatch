# PRD-015: Live Tail

Parent: [Design: Trace v2](../design/trace-v2.md)
Status: DRAFT
Date: 2026-04-22

## What This Is

A real-time streaming view of traces as they arrive. Users listed this as a top request. For an observability product, live debugging is the difference between "I review what happened" and "I watch what's happening." Without it, every active incident sends users to `grep`, Datadog, or raw logs.

Live Tail is a separate page/mode from the main Observe table. Accessible via the "Live Tail" nav item (currently greyed out in the nav bar across all PRDs).

## When to Use

- Debugging a live incident ("the agent is failing right now, show me what's happening")
- Monitoring a deploy ("I just pushed, are traces coming through?")
- Watching simulations run ("show me simulation results as they complete")
- First-data experience ("I just integrated the SDK, are traces arriving?")

## Layout

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ [LangWatch]  Observe  Live Tail                                             │
├──────────────────────────────────────────────────────────────────────────────┤
│ 🔍 @status:error @service:finance-bot              [Pause ⏸] [Clear] [⚙]  │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ● 12:04:23.412  agent.run        finance-bot   1.2s  $0.003  ● OK         │
│  ● 12:04:22.891  llm.openai.chat  support       0.8s  $0.001  ● OK         │
│  ● 12:04:22.003  agent.run        research      4.1s  $0.008  ● ERR        │
│  ● 12:04:21.556  rag.retrieve     finance-bot   0.3s  $0.000  ● OK         │
│  ● 12:04:20.112  agent.run        finance-bot   2.3s  $0.004  ● OK         │
│  ● 12:04:19.887  llm.openai.chat  support       0.5s  $0.001  ● OK         │
│  ...                                                                         │
│                                                                              │
│  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ │
│  ● Live  ·  142 traces/min  ·  3 errors/min  ·  avg 1.4s                   │
└──────────────────────────────────────────────────────────────────────────────┘
```

## How It Works

### Connection

- Uses WebSocket or Server-Sent Events (SSE) for real-time trace streaming
- Connects when the Live Tail page is opened
- Disconnects when navigating away (no background resource usage)
- Reconnects automatically on connection drop with backoff

### Stream Behavior

- New traces appear at the top of the list, pushing older traces down
- **Auto-scroll:** When the user is at the top of the list, new traces auto-insert with a smooth animation. When the user scrolls down to inspect older traces, auto-scroll pauses and a "↑ N new traces" banner appears (same pattern as PRD-002 real-time updates).
- **Buffer:** Keep the last ~500 traces in memory. Older traces fall off the bottom. This is a live stream, not a persisted list.
- **Rate limiting:** If traces arrive faster than the UI can render (>50/sec), batch them and insert in chunks every 200ms. Show a "high volume" indicator.

### Filtering

- Same search syntax as the main Observe page (PRD-003): `@status:error`, `@service:finance-bot`, `@model:gpt-4o`, free text search
- Filters apply to the stream in real-time — only matching traces appear
- No filter sidebar (too heavy for a streaming view). Search bar only.
- Filters are applied server-side when possible (reduces WebSocket payload)

### Controls

- **[Pause ⏸]:** Pauses the stream. New traces buffer silently. Button changes to [Resume ▶] with a count of buffered traces. Click resume to flush buffer.
- **[Clear]:** Clears the current list. Stream continues.
- **[⚙]:** Settings popover:
  - Show/hide columns (same column set as trace table)
  - Sound alert on errors (off by default)
  - Auto-pause when drawer opens (on by default)

### Status Bar

Fixed at the bottom:

```
● Live  ·  142 traces/min  ·  3 errors/min  ·  avg 1.4s
```

- **● Live** indicator (green dot, pulses) — or "● Paused" (yellow)
- Traces per minute (rolling 1-min window)
- Errors per minute (rolling 1-min window)
- Average duration (rolling 1-min window)

These update every 5 seconds.

## Trace Rows

Same format as the main trace table (PRD-002) but with absolute timestamps instead of relative ("12:04:23" not "2m ago"):

- Compact, single-line rows (~32px height, always compact density)
- Columns: timestamp (absolute, HH:MM:SS.mmm), root span name, service, duration, cost, status
- No I/O preview rows (too much vertical space for streaming)
- Error rows get a subtle red left border
- Click a row → opens the trace drawer (same drawer as PRD-004)

## Drawer Integration

- Clicking a Live Tail row opens the trace drawer (same drawer shell as PRD-004)
- **Auto-pause:** When the drawer opens, the stream pauses automatically (default, configurable). This prevents the list from jumping while you're reading.
- The drawer shows the full trace detail (viz, tabs, accordions) — same as clicking from the Observe table.
- Closing the drawer resumes the stream (if auto-pause is on).
- Up/Down arrows in the drawer navigate to adjacent traces in the live tail list.

## Relationship to Observe Page

Live Tail and Observe are sibling pages, not modes of the same page:

| | Observe | Live Tail |
|---|---|---|
| Data source | Paginated query to trace_summaries | WebSocket/SSE stream |
| Time range | Historical (any range) | Now (last ~500 traces) |
| Filters | Full sidebar + search | Search bar only |
| Presets | All Traces / Conversations / Errors | None (flat list) |
| Density | Compact / Comfortable | Always compact |
| I/O preview | LLM traces show ↑/↓ rows | No I/O preview |
| Real-time | Banner for new traces | Auto-inserting stream |
| Drawer | Same drawer | Same drawer |

### Navigation

- Nav bar: `Observe  Live Tail`
- Live Tail is its own page/route: `/live-tail`
- Filters from Observe do NOT carry over to Live Tail (different contexts)
- A "View in Observe" link on Live Tail traces opens the trace in the main Observe page (for historical context, adjacent traces, etc.)

## Loading States

- **Connecting:** "Connecting to live stream..." with spinner
- **Connected, no traces yet:** "Waiting for traces... Stream is live." with pulsing dot
- **Connected, traces flowing:** Normal view
- **Disconnected:** "Connection lost. Reconnecting..." with retry countdown
- **Error:** "Failed to connect to live stream. [Retry]"

## Data Gating

- **No traces in project:** Same onboarding empty state as PRD-001, but with the added message "Once traces arrive, they'll appear here in real-time."
- **Filters match nothing:** "No traces matching current filters" with clear filters link. Stream continues silently.
- **Very high volume (>100 traces/sec):** Show rate-limited indicator: "Sampling: showing 1 in N traces at current volume." Filter to reduce noise.

## Accessibility

- **Keyboard:** Up/Down navigate rows. Enter opens drawer. `P` toggles pause/resume. `C` clears the list. Escape closes drawer (same cascade as PRD-004).
- **Screen reader:** Status bar is an `aria-live="polite"` region. New trace count announced every 10 seconds (not every trace — too noisy). Pause/resume state announced.
- **Reduced motion:** When `prefers-reduced-motion` is set, new traces appear instantly without slide animation.
- **Focus management:** When drawer opens and auto-pause activates, focus moves to drawer. When drawer closes, focus returns to the trace row that was selected.

## Phase

Phase 1 — this is critical for an observability product. Users in active incidents need real-time visibility. Without this, LangWatch is a post-mortem tool, not an observability tool.

## Implementation Notes

- The streaming backend can be a thin layer: subscribe to ClickHouse's changelog or use a message queue (Kafka/Redis streams) that the ingestion pipeline already writes to
- Server-side filtering reduces WebSocket payload significantly
- The 500-trace buffer prevents memory bloat on the client
- Compact-only density keeps rendering fast at high throughput
