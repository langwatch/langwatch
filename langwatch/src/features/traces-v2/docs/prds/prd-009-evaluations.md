# PRD-009: Evaluations Display

Parent: [Design: Trace v2](../design/trace-v2.md)
Status: DRAFT
Date: 2026-04-22

## What This Is

How automated evaluation scores are displayed within the trace drawer. This covers the Evals accordion in the detail section and how eval data surfaces in other parts of the UI.

**Classification:** Evaluations are automated quality scoring only (sentiment analysis, faithfulness, toxicity, prompt injection detection, topic adherence, etc.). User feedback (thumbs up/down, ratings, annotations) is NOT an evaluation. User feedback is an event and appears in the Events accordion (PRD-005).

## When This Shows

- Evals tab in the trace-level detail section (PRD-005)
- Eval score columns in the trace table (PRD-002, hidden by default)
- Eval badges in the concept design (inline with trace rows)

## Evals Accordion (Trace Summary Tab)

Shows all evaluation results hoisted from all spans in this trace. Each eval links back to its originating span. This accordion only appears on the Trace Summary tab — the span tab (PRD-006) does not show evals.

```
┌──────────────────────────────────────────────────────────┐
│  ▶ Evals (3)                                             │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │ Topic Adherence              +0.8s     8.2 / 10   │  │
│  │ ████████░░                                        │  │
│  │ The response stayed on topic regarding refund     │  │
│  │ policy but briefly diverged into shipping...      │  │
│  │ ┈ from llm.openai.chat                            │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │ Faithfulness                 +1.2s     9.1 / 10   │  │
│  │ █████████░                                        │  │
│  │ All claims in the response are supported by the   │  │
│  │ retrieved documents.                              │  │
│  │ ┈ from llm.openai.chat                            │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  ┌──────────────────────────────────────────────── ●R ┐  │
│  │ Prompt Injection Detection    +1.5s     FAIL      │  │
│  │ ██████████  score: 0.78 (threshold: 0.5)          │  │
│  │ Potential prompt injection detected in user       │  │
│  │ input: "ignore previous instructions..."          │  │
│  │ ┈ from guardrail.pii_check                        │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### Eval Card Layout

Compact cards. Each eval type gets ONE card showing the most recent run, with run history inline.

**Single run (most common):**
```
┌────────────────────────────────────────────────────────┐
│ ● Topic Adherence    +0.8s   8.2/10   ┈ llm.chat  ▾ │
│   Stayed on topic, briefly diverged into shipping...  │
└────────────────────────────────────────────────────────┘
```

**Multiple runs (same eval ran N times on this trace):**
```
┌────────────────────────────────────────────────────────┐
│ ● Faithfulness  +2.0s  9.1/10  ▁▂▃▅█ (5)  ┈ llm  ▾ │
│   All claims supported by retrieved docs.             │
└────────────────────────────────────────────────────────┘
```

**Multiple runs, pass/fail eval:**
```
┌────────────────────────────────────────────────────────┐
│ ● Prompt Injection  +1.5s  PASS  ●●○● (4)  ┈ guard ▾│
│   No injection detected.                              │
└────────────────────────────────────────────────────────┘
```

**Card structure (2 lines max when collapsed):**
- **Line 1:** Color dot + eval name + timestamp + score + run history indicator + span origin + expand chevron
- **Line 2:** Reasoning snippet (truncated to ~60 chars, one line). Click chevron to expand.

**Compact design rules:**
- Cards are 2 lines tall by default. Not 5-6 lines.
- Score bar is replaced by the colored dot (green/yellow/red) next to the eval name. The dot IS the score bar.
- Reasoning is one truncated line. Expand (▾) to see full text, metadata, and action links.
- Span origin is inline on line 1 as `┈ llm.chat` (truncated span name), not a separate line. Clickable.

**Expanded card (click ▾):**
```
┌────────────────────────────────────────────────────────┐
│ ● Topic Adherence    +0.8s   8.2/10   ┈ llm.chat  ▴ │
│                                                        │
│   The response stayed on topic regarding refund        │
│   policy but briefly diverged into shipping policy     │
│   when discussing international orders.                │
│                                                        │
│   Processed  ·  1.3s  ·  $0.002                       │
│   ┈ from llm.openai.chat (a3f8c2d1)                   │
│   [Edit evaluator]  [Filter by this eval →]            │
└────────────────────────────────────────────────────────┘
```

### Run History

The same eval type can run multiple times on the same trace (e.g., when a new span arrives and the trace is re-evaluated). The eval card always shows the MOST RECENT run. Run history is shown inline.

**Run history indicators (inline on line 1):**
- **Numeric evals (0-10, 0-1):** Mini sparkline showing score trajectory over runs. 5 data points max (most recent 5 runs). Rendered as a tiny inline SVG (~30px wide, 12px tall). Hover tooltip shows exact scores and timestamps.
- **Pass/fail evals:** Colored dots. Green dot = pass, red dot = fail. Hollow dot = the run you're currently viewing. Left to right = oldest to newest. Max 8 dots.
- **Single run:** No history indicator. Just the score.
- **"(N)" count** after the indicator shows total runs.

**Expanded run timeline (click the sparkline or dots):**
```
┌────────────────────────────────────────────────────────┐
│ ● Faithfulness  +2.0s  9.1/10  ▁▂▃▅█ (5)  ┈ llm  ▴ │
│                                                        │
│   All claims supported by retrieved docs.              │
│                                                        │
│   RUN HISTORY                                          │
│   ● 9.1  +2.0s  latest                                │
│     ┈ triggered by: llm.openai.chat (span update)      │
│   ● 8.4  +1.5s                                        │
│     ┈ triggered by: tool.search_db (new span)          │
│   ● 3.2  +1.0s  FAIL                                  │
│     Response contains unverified claim...              │
│     ┈ triggered by: llm.openai.chat (span update)      │
│   ● 7.8  +0.5s                                        │
│   ● 7.2  +0.1s  first run                             │
│                                                        │
│   Processed  ·  1.3s  ·  $0.002                        │
│   [Edit evaluator]  [Filter by this eval →]            │
└────────────────────────────────────────────────────────┘
```

Each historical run shows:
- Score with colored dot
- Timestamp offset from trace start
- **What triggered the re-evaluation** (which span was added/updated)
- Reasoning snippet (collapsed by default, expand individually)
- "latest" / "first run" / "FAIL" labels where applicable

**Accordion header count:** Count distinct eval TYPES, not runs. If Faithfulness ran 5 times and Toxicity ran 3 times, header shows "Evals (2)" not "Evals (8)".

### Eval Card Interactions

- **Span origin link:** Span name is clickable, opens that span's tab. Hovering highlights the span in the visualization.
- **Action links (expanded only):**
  - **[Edit evaluator]:** Links to evaluator config in LangWatch. Opens in new context.
  - **[Filter by this eval →]:** Applies `@has:eval:Topic Adherence` to the search bar.
- **Color coding:**
  - Pass / high score (>7/10): green dot
  - Warning / medium score (4-7/10): yellow dot
  - Fail / low score (<4/10): red dot
- **Card border:** Subtle 2px left border in the score color at ~20% opacity. Failed evals get red border but shouldn't scream.

### Score Types

Evaluations can have different score formats:

| Format | Display | Example |
|---|---|---|
| Numeric (0-10) | `8.2 / 10` with fill bar | Topic Adherence |
| Numeric (0-1) | `0.82` with fill bar | Similarity score |
| Boolean (pass/fail) | `PASS` or `FAIL` badge | Prompt Injection |
| Categorical | Text label | Sentiment: "Positive" |

The display adapts to the score type. All types get a color-coded bar or badge.

### No Evals State

If the trace has no evaluation results:

```
┌──────────────────────────────────────────────────────────┐
│  No evaluations for this trace                           │
│                                                          │
│  Evaluations automatically score your traces on          │
│  quality, safety, and accuracy.                          │
│  Set up evaluations →                                    │
└──────────────────────────────────────────────────────────┘
```

Link to existing LangWatch evaluation setup.

## Annotations

Annotations are human-provided corrections or notes on a trace. Shown below eval cards if present.

```
┌──────────────────────────────────────────────────────────┐
│  ANNOTATIONS                                    1 total  │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │ 📝 Corrected Output                   by @sarah   │  │
│  │ Added 2026-04-20                                  │  │
│  │                                                    │  │
│  │ Original: "Returns are accepted within 15 days"   │  │
│  │ Corrected: "Returns are accepted within 30 days"  │  │
│  │                                                    │  │
│  │ Note: "Policy changed in March 2026"              │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

- Each annotation: author, date, original vs corrected output (if applicable), free-text note
- Annotations are read-only in Phase 1 (creating/editing annotations is existing LangWatch functionality, linked out)

## Feedback

Feedback (thumbs up/down, satisfaction scores) is **not a special UI section** — it's just another event type. Feedback events appear in the Events accordion (PRD-005) alongside guardrail results, cache hits, and other events. They are queried and filtered the same way as any other event.

**Important: Feedback is event data, not a first-class field on the trace summary.** There is no `thumbsUpDown` or `satisfactionScore` field on the trace object. Feedback is stored as events (e.g., event type `user.feedback`, attributes `{vote: "up"}` or `{satisfaction: 3.2}`). This means:
- Feedback is queried the same way as any other event type
- Customers can add their own custom feedback event types using the same mechanism
- The trace summary does not carry feedback fields — they come from the events
- Filtering by feedback (e.g., "show traces with negative feedback") uses the event filter: `@has:feedback` or `@event:user.feedback`

If users want to see feedback in the trace table, they enable it via the column selector like any other event type.

## Table Integration

In the trace table (PRD-002), eval and event data surfaces in two ways:

**Individual eval columns (opt-in via Column selector):**
- One column per eval type, user picks which ones to show
- Shows compact value: `● 8.2` (green), `● 4.1` (yellow), `● ✗` (red)
- Sortable — "show me lowest faithfulness first"
- When an eval is shown as its own column, it's excluded from the summary badges

**Evals summary column (opt-in via Column selector):**
- Single column showing compact inline badges for all evals (or remaining evals not shown as individual columns)
- Badges: `● [short name] [score or ✓/✗]` — colored dot (green/yellow/red)
- Max 2-3 badges visible per row based on column width
- `+N` overflow — hover tooltip lists all evals
- Click any badge → popover with score, status, reasoning detail

**Events summary column (opt-in via Column selector):**
- Shows event count + exception indicator: `3 ⚠` (3 events, has exception) or `1` (1 event) or `—`
- Exception types shown as compact badges if enabled: `⚠ RateLimitError`

## Data Gating

- **No evals, no annotations:** Show "No evaluations for this trace" with setup link in the drawer. Don't hide the accordion.
- **Evals but no detail/reasoning:** Show eval name + score only, no detail text
- **Multiple eval runs:** If the same eval type has been run multiple times, show the most recent result. Collapsible "History" to see prior runs.
