# PRD-006: Span View (Span Tab)

Parent: [Design: Trace v2](../design/trace-v2.md)
Status: DRAFT
Date: 2026-04-22

## What This Is

What the accordion sections show when a span is selected via the span tab. The span tab appears in the tab bar (between viz and accordions) when a user clicks a span in the visualization. It shows span-specific data: I/O, Attributes, and any exceptions, events, or evals that belong to THIS specific span. The Trace Summary tab (PRD-005) shows ALL exceptions/events/evals hoisted across all spans. The span tab shows only the ones originating from the selected span.

## When This Shows

- User clicks a span in the tree, waterfall, or Flame visualization (PRD-007)
- A span tab appears in the tab bar next to the Trace Summary tab, and becomes active
- The visualization stays visible with the selected span highlighted
- The accordion content switches to span-level data with a fade animation
- Clicking a different span updates the span tab
- Clicking the same span, ×, Escape, or empty space in the viz closes the span tab (back to Trace Summary)
- See PRD-004 for full tab bar behavior

## Layout

```
┌──────────────────────────────────────────────────────────┐
│  ┌──────────┐ ┌────────────────────────────────────┐     │
│  │ Trace Summary │ │ llm.openai.chat  LLM  1.1s  ×     │     │
│  ╘══════════╛ ╘════════════════════════════════════╧═════╡
│  ▼ I/O                                                   │
│  ▶ Attributes                                            │
│  ▶ Exceptions (1)          ← only if this span has errors│
│  ▶ Events (2)              ← only if this span has events│
│  ▶ Evals (1)               ← only if this span has evals│
└──────────────────────────────────────────────────────────┘
```

The span tab in the tab bar shows: span name, type badge (colored), key metrics (duration, cost if applicable), and × to close.

## Span Tab Label

The span tab in the tab bar shows key span identity and metrics inline:

- **Span name:** e.g. `llm.openai.chat`, `tool.search_documents`, `agent.plan_next_step`
- **Span ID:** Truncated to 8 chars, monospace, muted. Full ID on hover. Copy-to-clipboard button. Example: `a3f8c2d1 📋`
- **Span type badge:** colored label matching the visualization colors (LLM = blue, Tool = green, Agent = purple, RAG = orange, Guardrail = yellow, Span = gray)
- **Inline metrics:** duration, cost (if applicable), model (if LLM span)
- **× close button:** closes the span tab, returns to Trace Summary
- **Status:** if this span has an error, show error dot on the tab

Metrics that don't apply to this span type are hidden, not shown as "—". A tool span doesn't show model or tokens.

## Accordion Sections

### I/O (default: open)

Shows this span's input and output.

```
┌──────────────────────────────────────────────────────────┐
│  INPUT                                    [Text][JSON]   │
│  ┌────────────────────────────────────────────────────┐  │
│  │ {                                                  │  │
│  │   "role": "user",                                  │  │
│  │   "content": "Analyze the Q3 revenue report..."    │  │
│  │ }                                                  │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  OUTPUT                                   [Text][JSON]   │
│  ┌────────────────────────────────────────────────────┐  │
│  │ {                                                  │  │
│  │   "role": "assistant",                             │  │
│  │   "content": "Based on the Q3 data, revenue..."   │  │
│  │ }                                                  │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

- Same I/O viewer component as the trace view (PRD-005). Same data-driven rendering — the renderer inspects the data shape, not the span type. See PRD-005 I/O Rendering section for the full detection rules, markdown sanitization, and multimodal handling.
- Format toggle: Pretty (default) / Text / JSON. Pretty = rich rendering with role icons and formatting. Text = raw string. JSON = raw JSON with syntax highlighting.
- Copy-to-clipboard per section.
- Truncation + "Show full" expander for long content.
- If input or output is absent: show "No input/output captured for this span."

### Attributes (default: closed, auto-opens for non-LLM spans where I/O may be empty)

Shows span attributes and resource attributes as key-value pairs. This is a shared component used for trace attributes (PRD-005), span attributes, and event attributes.

**Flat view (default):**
```
┌──────────────────────────────────────────────────────────┐
│  SPAN ATTRIBUTES                          [Flat][JSON]   │
│  ┌────────────────────────────────────────────────────┐  │
│  │ gen_ai.operation.name     chat                [📋]│  │
│  │ gen_ai.request.model      gpt-4o              [📋]│  │
│  │ gen_ai.usage.input_tokens  520                [📋]│  │
│  │ gen_ai.usage.output_tokens 380                [📋]│  │
│  │ langwatch.span.cost       0.002               [📋]│  │
│  │ langwatch.span.type       llm                 [📋]│  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  RESOURCE ATTRIBUTES                      [Flat][JSON]   │
│  ┌────────────────────────────────────────────────────┐  │
│  │ deployment.environment    production           [📋]│  │
│  │ sdk.language              python               [📋]│  │
│  │ sdk.name                  opentelemetry        [📋]│  │
│  │ service.name              finance-bot          [📋]│  │
│  │ service.version           2.4.1                [📋]│  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

**JSON view (nested):**
```
┌──────────────────────────────────────────────────────────┐
│  SPAN ATTRIBUTES                          [Flat][JSON]   │
│  ┌────────────────────────────────────────────────────┐  │
│  │ {                                             [📋]│  │
│  │   "gen_ai": {                                     │  │
│  │     "operation": { "name": "chat" },              │  │
│  │     "request": { "model": "gpt-4o" },             │  │
│  │     "usage": {                                    │  │
│  │       "input_tokens": 520,                        │  │
│  │       "output_tokens": 380                        │  │
│  │     }                                             │  │
│  │   },                                              │  │
│  │   "langwatch": {                                  │  │
│  │     "span": { "cost": 0.002, "type": "llm" }     │  │
│  │   }                                               │  │
│  │ }                                                 │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

- Two sections: Span Attributes (application-level) and Resource Attributes (infrastructure-level)
- Each attribute: key (monospace, muted color) + value (monospace) + copy button
- **Toggle between Flat and JSON views:**
  - **Flat:** every key-value on its own row, full dot-concatenated key shown (e.g. `gen_ai.request.model`). Sorted alphabetically. This is the default.
  - **JSON:** dot-separated keys are reconstituted into nested JSON objects (e.g. `service.name` + `service.version` → `{"service": {"name": "...", "version": "..."}}`). Syntax highlighted, collapsible nodes, copy-all button.
- The same Flat/JSON toggle is used everywhere attributes appear: trace attributes (PRD-005), span attributes, and event attributes within the Events accordion.
- Long values: truncated with "Show full" expander
- Search/filter within attributes: small search input at top of section to filter by key or value

## Interaction

- **Close span tab:** Click × on span tab, press Escape, click same span again, or click empty space in viz. Returns to Trace Summary tab with fade animation.
- **Switch span:** Click a different span in the visualization. Span tab updates to new span with fade animation.
- **Switch to Trace Summary:** Click the Trace Summary tab. Span tab persists — can switch back.
- **Keyboard:** Escape closes span tab. Arrow keys in the span tree move between spans (span tab updates). O switches to Trace Summary tab.

## Auto-Open Rules (Span Tab)

| Context | I/O | Attributes |
|---|---|---|
| LLM span | **Open** | Closed |
| Tool span | **Open** (args + return) | Closed |
| Non-LLM span with no I/O | Closed | **Open** |
| Any span with error | **Open** | Closed |

**Accordion order:** I/O → Prompt (if managed prompt detected, see PRD-010) → Attributes → Exceptions → Events → Evals

Multiple accordions can be open simultaneously.

### Exceptions (conditional, only if this span has errors)

Shows exceptions originating from THIS span only. Same component as PRD-005 Exceptions accordion, but filtered to this span's exceptions.

- Only rendered if this span has exception events. If no exceptions, this accordion is hidden entirely (not empty state).
- Auto-opens if this span has error status.
- Same display format as PRD-005: error icon, exception type + message, stack trace in collapsible block.
- No `┈ from [span name]` link needed (you're already on that span).

### Events (conditional, only if this span has events)

Shows informational events originating from THIS span only. Same component as PRD-005 Events accordion, but filtered to this span's events.

- Only rendered if this span has events. If no events, this accordion is hidden entirely.
- Same display format as PRD-005: event name, timestamp offset, attributes.
- User feedback events (thumbs up/down) that target this span appear here.
- No `┈ from [span name]` link needed.

### Evals (conditional, only if this span has evals)

Shows evaluation results that ran on THIS span only. Same component as PRD-009 eval cards, but filtered to this span's evals.

- Only rendered if this span has eval results. If no evals, this accordion is hidden entirely.
- Same compact card format as PRD-009 (2-line cards, run history sparkline/dots).
- No `┈ from [span name]` link needed.

### Relationship to Trace Summary Tab

The Trace Summary tab (PRD-005) shows ALL exceptions/events/evals hoisted across ALL spans with `┈ from [span name]` links. The span tab shows only what belongs to the selected span. Both views exist simultaneously (tab switching, not replacement). The user can see "all 5 exceptions across the trace" on Trace Summary, then click into a specific span to see "the 1 exception from this span."

## Auto-Open Rules (Span Tab)

| Context | I/O | Attributes | Exceptions | Events | Evals |
|---|---|---|---|---|---|
| LLM span | **Open** | Closed | Auto if error | Closed | Closed |
| Tool span | **Open** | Closed | Auto if error | Closed | Closed |
| Non-LLM span with no I/O | Closed | **Open** | Auto if error | Closed | Closed |
| Span with error | **Open** | Closed | **Open** | Closed | Closed |
| Span with failed eval | **Open** | Closed | Closed | Closed | **Open** |

## Data Gating

- **No input/output:** "No input/output captured for this span". Accordion auto-closed.
- **No attributes:** "No attributes recorded" (unlikely but handle it). Auto-closed.
- **No exceptions:** Accordion hidden entirely (not rendered).
- **No events:** Accordion hidden entirely (not rendered).
- **No evals:** Accordion hidden entirely (not rendered).
- **Non-LLM spans:** Hide model and token metrics from the span tab label.
- **Empty attribute values:** Show the key with value "—"
