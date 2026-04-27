# PRD-005: Trace View (Trace Summary Tab)

Parent: [Design: Trace v2](../design/trace-v2.md)
Status: DRAFT
Date: 2026-04-22

## What This Is

The trace-level detail display within the drawer — the "Trace Summary" tab. This is what you see in the detail section (below the visualization) when the Trace Summary tab is active. Shows trace-level I/O, hoisted events and evals from all spans (with span origin links), and trace attributes. Conversation context is handled by the Trace ↔ Conversation mode switch in the drawer shell (PRD-004), not as an accordion here.

## Data Model: Hoisted Data

Traces in LangWatch are enriched — data from individual spans is hoisted up to the trace level:

- **Events** from all spans are hoisted to the trace, with a mapping back to the originating span
- **Evaluations** from all spans are hoisted to the trace, with span origin preserved
- **Attributes** from the root span and resource are shown at trace level

This means the Trace Summary tab shows a complete picture of everything that happened in the trace, across all spans, without needing to click into individual spans. Each hoisted event/eval links back to its originating span — clicking the span name opens that span's tab (see PRD-004: Span Selection).

## When This Shows

- Default state when the drawer opens (Trace Summary tab active)
- When user clicks "Trace Summary" tab to return from a span tab
- When span tab is closed (×, Escape, click same span)
- The visualization (PRD-007) remains visible above — this section is below the tab bar

## Layout

The detail section uses **collapsible accordions**, not tabs. Multiple sections can be open simultaneously. Sections auto-open based on context (see Auto-Open Rules below).

```
┌──────────────────────────────────────────────────────────┐
│  ▼ I/O                                    [Text][JSON]   │
│  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─   │
│  INPUT                                                   │
│  ┌────────────────────────────────────────────────────┐  │
│  │ "Analyze the Q3 revenue report and suggest        │  │
│  │  improvements to our cost structure. Focus on     │  │
│  │  the engineering department specifically."         │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  OUTPUT                                   [Text][JSON]   │
│  ┌────────────────────────────────────────────────────┐  │
│  │ "Based on the Q3 data, engineering spend grew     │  │
│  │  18% while headcount grew 12%. The main drivers   │  │
│  │  are: 1) Cloud infrastructure costs (+34%)..."    │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  model: gpt-4o              (actions: see PRD-010)      │
└──────────────────────────────────────────────────────────┘
```

## Accordion Sections

### I/O (default: open)

Shows the computed input and output for the entire trace.

**Format toggle** in top-right: Pretty (default) / Text / JSON

### I/O Rendering (data-driven, not type-driven)

The I/O viewer renders based on **the shape of the data**, not the span type. The span type label (LLM, Tool, Agent, etc.) is cosmetic — it cannot be trusted to determine rendering. The renderer inspects the actual I/O content and picks the appropriate display.

**Three display modes:**

- **Pretty** (default): Data-driven rich rendering. Detects the data shape and shows it in the most readable format. Chat messages get role icons and conversation layout. Tool calls show function name + args. This is the mode that makes data easy to read.
- **Text**: Raw plain text. No formatting, no role icons, no syntax highlighting. Just the string content as-is. Useful for copying or when the pretty rendering is wrong.
- **JSON**: Raw JSON with syntax highlighting and collapsible nodes. Shows the exact data structure as received.

**Pretty mode detection rules (applied in order):**

1. **Chat messages array:** If the data is a JSON array where items have `role` and `content` fields (the `gen_ai.input.messages` / `gen_ai.output.messages` format), render as a conversation:

```
┌──────────────────────────────────────────────────────────┐
│  INPUT                                    [Text][JSON]   │
│                                                          │
│  ⚙ SYSTEM                                               │
│  "You are a financial advisor specializing in refund     │
│   policy questions."                                     │
│                                                          │
│  👤 USER                                                 │
│  "What's the refund policy for orders over $500?"        │
│                                                          │
│  OUTPUT                                                  │
│                                                          │
│  🤖 ASSISTANT                                            │
│  "For orders over $500, our refund policy allows a full  │
│   return within 30 days of purchase..."                  │
│                                                          │
│  🔧 TOOL CALL: search_policy                             │
│  Arguments: {"category": "refund", "min_amount": 500}    │
│  Result: {"policy_id": "REF-500", "text": "..."}         │
└──────────────────────────────────────────────────────────┘
```

   - Detected by: array of objects with `role` key
   - Role icons from the `role` value: `system` → ⚙, `user` → 👤, `assistant` → 🤖, `tool` → 🔧
   - If `tool_calls` array exists on a message, render as tool call with function name + arguments
   - If `content` is an array (multimodal), render each content item by its `type` field (see below)

2. **JSON object or array (non-chat):** If the data parses as JSON but doesn't have `role` fields, render as formatted, readable key-value display.

3. **Plain text:** If the data is a string that isn't valid JSON, render as readable text with markdown formatting.

**The `langwatch.reserved.value_types` attribute provides hints** (e.g., `langwatch.input=chat_messages`, `langwatch.input=json`, `langwatch.input=text`) but the renderer should gracefully handle data that doesn't match the hint. The hint optimizes rendering; it doesn't gate it.

**Format toggle:** Pretty (default) / Text / JSON. Pretty mode applies the detection rules above. Text mode shows the raw string content with no formatting. JSON mode always shows raw JSON with syntax highlighting and collapsible nodes.

**Markdown rendering:** String content in messages may contain markdown. Render as formatted HTML using a sanitizing markdown renderer. **Security: all content MUST be sanitized** — strip `<script>`, `<iframe>`, event handlers, raw HTML. Use `react-markdown` with `rehype-sanitize` or equivalent.

**Multimodal content (future):** When a `content` item has `type: "image_url"`, `type: "audio"`, or similar:
- **Images:** Render inline as thumbnails (~200px max width). Click to expand.
- **Audio/Video:** Show player or download link.
- Phase 1 fallback for unrecognized content types: `[Image: 1.2MB PNG]` or `[Unsupported content type: audio]` with raw data in JSON mode.

**Content display rules:**
- Text mode: max height ~300px, then scroll. Full content always accessible.
- JSON mode: collapsible tree with expand all / collapse all controls
- Copy-to-clipboard button on each section (copies the raw content)
- If content is very long (>5000 chars in text mode), truncate with "Show full output" expander
- If input is empty/null: show "No input captured" in muted text
- If output is empty/null: show "No output captured"

### Attributes (default: closed)

Trace-level and resource attributes as key-value pairs. Same component as span attributes (PRD-006) but showing trace-level data.

- **Section label: "Trace Attributes"** (not "Span Attributes" — the component is shared but the label must reflect the context). Two sub-sections: "Trace Attributes" (from root span's `SpanAttributes`) and "Resource Attributes" (from root span's `ResourceAttributes`).
- Promoted attributes appear in the header (PRD-008), not duplicated here
- **Flat/JSON toggle**, search/filter within attributes, copy-to-clipboard per value
- See PRD-006 Attributes section for full component spec (shared attribute component)

### Exceptions (default: closed, auto-opens if trace has errors)

Exceptions hoisted from all spans within this trace. Separate from Events — exceptions are errors, not informational events. Each exception links back to its originating span.

```
┌──────────────────────────────────────────────────────────┐
│  1 exception                                             │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  ❌ RateLimitError                               +0.8s  │
│  Rate limit exceeded for gpt-4o. Retry attempt 3 of 3.  │
│  ┌──────────────────────────────────────────────────┐    │
│  │ File "agent.py", line 47, in call_llm            │    │
│  │   response = client.chat.completions.create(...  │    │
│  │ File "openai/api.py", line 312                   │    │
│  │   raise RateLimitError(...)                      │    │
│  └──────────────────────────────────────────────────┘    │
│  ┈ from llm.openai.chat                                 │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

- Hoisted from all spans — every exception in the trace appears here
- Each exception: error icon, exception type + message, timing offset
- **Span origin link:** `┈ from [span name] (span ID)` line below each exception, muted text. Span name is clickable — opens that span's tab. Span ID shown in parentheses, truncated to 8 chars. **Hover behavior:** hovering the span origin link highlights the corresponding span in the visualization above (border glow or background pulse). This works across all three viz modes (Waterfall, Flame, Span List). Links resolve via span ID (unique), not span name (which may be duplicated across spans). All span origin links are clickable, including on exceptions.
- Stack trace in collapsible monospace block
- Red left border on each exception
- Sorted by timestamp ascending
- If no exceptions: section hidden entirely (not "no exceptions" empty state)

### Events (default: closed)

Informational events hoisted from all spans within this trace. NOT exceptions — those are in the Exceptions accordion above. **User feedback** (thumbs up/down, ratings, annotations) is an event, not an evaluation. Evaluations are automated scoring only (sentiment analysis, faithfulness, toxicity, etc.).

```
┌──────────────────────────────────────────────────────────┐
│  4 events                                                │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  ℹ cache.hit                                     +0.1s  │
│    Documents retrieved from cache (3 results)            │
│    ┈ from tool.search_db                                 │
│                                                          │
│  ℹ guardrail.pass                                +1.2s  │
│    PII check passed, score: 0.98                         │
│    ┈ from guardrail.pii_check                            │
│                                                          │
│  ℹ retry.success                                 +1.5s  │
│    Retry attempt 2 succeeded                             │
│    ┈ from llm.openai.chat                                │
│                                                          │
│  👍 user.feedback                                +2.0s  │
│    Thumbs up                                             │
│    ┈ from (trace-level event)                            │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

- Hoisted from all spans — every informational event in the trace appears here
- Includes: guardrail results, cache hits, custom events, logs, **user feedback** (thumbs up/down, ratings, annotations)
- Each event: info icon, event name, timestamp offset from trace start
- **Span origin link:** `┈ from [span name] (span ID)` line below each event, muted text. Span name is clickable — opens that span's tab. Span ID shown in parentheses, truncated to 8 chars. Hovering highlights the corresponding span in the visualization above (border glow or background pulse). Links resolve via span ID (unique), not span name.
- Event attributes shown as collapsible key-value block with the same **Flat/JSON toggle** used for trace and span attributes (see PRD-006 Attributes section for the shared component spec)
- Sorted by timestamp ascending (chronological order preserved across spans)
- If no events: "No events recorded"

## Auto-Open Rules (Trace Summary Tab)

Accordions auto-open based on context to show the most relevant data first. These rules apply to the Trace Summary tab only — see PRD-006 for span tab auto-open rules.

| Context | I/O | Attributes | Exceptions | Events | Evals |
|---|---|---|---|---|---|
| Normal trace | Open | Closed | Closed | Closed | Closed |
| Trace with error | Open | Closed | **Open** | Closed | Closed |
| Trace with failed eval | Open | Closed | Closed | Closed | **Open** |
| Trace from Errors preset | Open | Closed | **Open** | Closed | Closed |
| Trace with no I/O | Closed | Open | Closed | Closed | Closed |

Multiple accordions can be open at once. User can manually open/close any section regardless of auto-open state.

**State persistence:**
- **Across tab switches (Trace Summary ↔ Span):** Each tab remembers its own accordion state. Switching to the span tab and back to Trace Summary does NOT reset the Trace Summary accordions. The user's manual open/close choices are preserved for the lifetime of the drawer being open.
- **Across traces:** NOT persisted. Each new trace gets fresh auto-open logic. Opening a different trace resets accordion state.

**Accordion order:** I/O → Attributes → Exceptions → Events → Evals

**Collapsed count badges:** When an accordion is collapsed, show the item count next to the section name: `▶ Events (3)`, `▶ Evals (2)`, `▶ Exceptions (1)`. When expanded, hide the count — the items are visible, so the count is redundant. I/O and Attributes don't show counts (they're always single sections, not lists).

## Data Gating

- **No input/output:** Accordion shows "No input/output captured" in muted text. Auto-closed.
- **No attributes:** Accordion shows "No attributes recorded". Auto-closed.
- **No exceptions:** Accordion hidden entirely (not shown, not empty state).
- **No events:** Accordion shows "No events recorded". Auto-closed.
- **No evals:** Section handled by PRD-009. Auto-closed.
- **Estimated values:** If cost is estimated, show "~" prefix with tooltip
