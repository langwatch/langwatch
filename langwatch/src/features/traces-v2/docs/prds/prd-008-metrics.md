# PRD-008: Metrics Display

Parent: [Design: Trace v2](../design/trace-v2.md)
Status: DRAFT
Date: 2026-04-22

## What This Is

How metrics (duration, cost, tokens, model, status) are displayed across the product. This covers the drawer header, the table cells, and how metrics adapt between trace-level and span-level views.

## Drawer Header

The header is the top section of the trace drawer. It shows the identity and key metrics of the current trace (or span, when a span is selected).

### Trace-Level Header

```
┌──────────────────────────────────────────────────────────────┐
│  agent.run                                    ● OK          │
│                                                              │
│  ⏱ 2.3s    💰 $0.004    📊 1.2K→380 tok    🤖 gpt-4o      │
│                                                              │
│  finance-bot  ·  production  ·  v2.4.1       2 min ago      │
└──────────────────────────────────────────────────────────────┘
```

- **Line 0 (subtle):** Trace ID, truncated to 8 chars, monospace, muted text, with copy-to-clipboard button. Always visible. Full ID on hover tooltip. Example: `trace: a3f8c2d1 📋`
- **Line 1:** Trace name (root span name) + status badge (colored dot + text)
- **Line 2:** Key metrics as compact pills/badges:
  - Duration: `2.3s`, `340ms`
  - TTFT: `180ms` (time to first token — only shown if available)
  - Cost: `$0.004`, `~$0.004` (~ prefix if estimated). Hover shows breakdown (see Cost Hover Breakdown below).
  - Tokens: `1.2K→380` (input→output, compact). Hover shows breakdown (see Token Hover Breakdown below).
  - Model: `gpt-4o` (if multiple: `gpt-4o +1`)
- **Line 3:** Context tags as `key: value` pills. Always show the attribute name, not just the value. Examples: `service: finance-bot`, `environment: production`, `version: 2.4.1`. Timestamp (relative, absolute on hover) at the end.
- **Promoted attributes:** Users can pin trace/span attributes to the header so they're always visible. Shown as additional `key: value` pills on line 3. Configurable per project (settings page, not in the drawer itself). Examples: `customer_id: usr_123`, `prompt_version: v1.4`, `deployment.region: us-east-1`. Default promoted attributes: `service.name`, `deployment.environment`, `service.version`. Max ~5 promoted attributes to avoid header bloat. If no attributes have been configured by the user yet, show the defaults with a subtle "Configure ⚙" link to educate (links to settings page, which is out of Phase 1 scope — link can be a no-op for now).

### Span Tab Metrics

When a span is selected in the visualization, the drawer header does NOT change (it stays showing trace-level info). Instead, a span tab appears in the tab bar between the visualization and the accordions (see PRD-004, PRD-006):

```
┌──────────┐ ┌──────────────────────────────────────────────┐
│ Trace Summary │ │ llm.openai.chat  LLM  1.1s  $0.002  ×      │
╘══════════╛ ╘══════════════════════════════════════════════╧══╡
```

- Span name + type badge + key metrics inline in the tab label
- × closes the tab (returns to Trace Summary)
- Only metrics relevant to this span type are shown (see table below)

### Metrics That Hide

Not all metrics apply to all span types. Hide (don't show "—") metrics that don't apply:

| Span Type | Duration | Cost | Tokens | Model | TTFT |
|---|---|---|---|---|---|
| LLM | ✓ | ✓ | ✓ | ✓ | ✓ |
| Tool | ✓ | ✗ | ✗ | ✗ | ✗ |
| Agent | ✓ | ✓ (aggregate) | ✓ (aggregate) | ✗ | ✗ |
| RAG | ✓ | ✗ | ✗ | ✗ | ✗ |
| Guardrail | ✓ | ✓ | ✓ | ✓ | ✗ |
| Generic | ✓ | ✗ | ✗ | ✗ | ✗ |

## Metric Formatting Rules

### Duration
- `< 1ms`: `0.3ms`
- `1-999ms`: `340ms`
- `1-59s`: `2.3s`
- `60s+`: `1m 12s`
- `600s+`: `10m 5s`
- Color coding (optional, subtle text color):
  - Green: faster than service p50
  - No color: within normal range
  - Yellow: >2x service p50
  - Red: >5x service p50

### Cost
- `< $0.01`: `$0.003` (3 decimal places)
- `$0.01-$0.99`: `$0.04` (2 decimal places)
- `$1+`: `$1.24` (2 decimal places)
- `$100+`: `$142` (no decimals)
- Estimated: `~$0.003` with tooltip "Cost estimated from token count"
- Zero: `$0.000` (show it, don't hide — useful to know a span was free)

**Cost Hover Breakdown:** Hovering the cost pill in the drawer header shows a tooltip with cost breakdown:

```
┌─────────────────────────────┐
│  Cost Breakdown             │
│  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  │
│  Input tokens     $0.0026   │
│  Output tokens    $0.0012   │
│  Cache read        $0.0002  │
│  Cache write          —     │
│  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  │
│  Total            $0.0040   │
└─────────────────────────────┘
```

- Only shows cost categories that have values (hide zero/absent categories)
- If cost is estimated, tooltip footer: "Estimated from token count"

### Tokens
- Combined (table): `1.2K` (total input + output)
- Split (header/detail): `520→380` or `1.2K→380` (input→output)
- Formatting: `< 1000`: show exact (`520`). `≥ 1000`: show K (`1.2K`). `≥ 1M`: show M (`1.2M`)

**Token Hover Breakdown:** Hovering the token pill in the drawer header shows a tooltip with full breakdown:

```
┌─────────────────────────────┐
│  Token Breakdown            │
│  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  │
│  Input              520     │
│    Cache read       380     │
│    Cache write       —      │
│  Output             380     │
│  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  │
│  Total              900     │
└─────────────────────────────┘
```

- Shows input/output split with cache sub-breakdowns
- Cache read tokens are tokens retrieved from prompt cache (cheaper)
- Cache write tokens are tokens written to prompt cache
- Only shows categories that have values

### Model
- Show provider/model format: `openai/gpt-4o`, `anthropic/claude-sonnet`, `openai/gpt-5-mini`
- In compact contexts (table cells), abbreviate: `oai/4o`, `ant/sonnet`, `oai/5m`
- If multiple models in a trace: show primary (most tokens) + `+N` badge
- The `+N` badge on hover shows a tooltip listing all models used
- If no model (non-LLM span): hide entirely

### Status
- **OK:** Green dot ●
- **Warning:** Yellow dot ● (e.g., slow but completed)
- **Error:** Red dot ● + error message available in drawer
- Dot is 8px, inline with text

### Time to First Token (TTFT)
- Shown in both trace header and span tab (for LLM spans)
- Trace-level TTFT: from `trace_summaries` (first token of the first LLM span in the trace)
- Span-level TTFT: from `gen_ai.server.time_to_first_token` attribute
- Format same as Duration (`180ms`, `1.2s`)
- If not available: hide entirely (don't show "—")

## Table Cell Formatting

In the trace table (PRD-002), metrics are formatted more compactly:

| Metric | Table format | Header format |
|---|---|---|
| Duration | `1.2s` | `⏱ 1.2s` |
| TTFT | `180ms` (hidden column by default) | `⚡ 180ms` |
| Cost | `$0.003` (hover: breakdown) | `💰 $0.003` (hover: breakdown) |
| Tokens | `1.2K` (combined, hover: breakdown) | `📊 520→380` (split, hover: breakdown) |
| Model | `4o` (very short) | `🤖 gpt-4o` (full short) |
| Status | Colored dot only | Dot + text |

Table cells are monospace for numeric alignment across rows.

## Tooltip Behavior

All metric hover tooltips (cost breakdown, token breakdown, TTFT explanation, model list) must:
- Stay within the viewport — auto-flip from below to above (or left to right) when near edges
- Never clip outside the drawer boundaries
- Use a consistent style: dark background, light text, subtle arrow pointer
- Include a brief label explaining the metric (e.g., TTFT tooltip: "Time to First Token — how long until the model started generating")
- Dismiss on mouse leave, not on click

## Comparison Indicators (future)

Space reserved for comparative indicators next to metrics:
- "▲ 2.1x avg" (slower than average)
- "▼ 30% cheaper" (below cost average)
- These require baseline data and are Phase 3+ (intelligence spikes). For Phase 1, just show the raw values.
