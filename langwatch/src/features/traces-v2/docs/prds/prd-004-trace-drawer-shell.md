# PRD-004: Trace Drawer Shell

Parent: [Design: Trace v2](../design/trace-v2.md)
Status: DRAFT
Date: 2026-04-22

## What This Is

The unified drawer container. One drawer, one shape, one shell — the content inside adapts to what you're viewing. This PRD covers the drawer's layout, animation, navigation stack, and how it composes the sub-views.

## Layout

The drawer opens from the right side when a trace or session is clicked in the table.

### Drawer Closed (table only)

```
┌────────────┬─────────────────────────────────────────────────────┐
│  FILTERS   │  TRACE TABLE (full width)                          │
│            │                                                     │
│  ...       │  ...                                                │
│            │                                                     │
└────────────┴─────────────────────────────────────────────────────┘
```

### Drawer Open (overlay)

The drawer overlays the table — it does NOT push or resize the table. The table continues to render at full width underneath.

```
┌────────────┬─────────────────────────────────────────────────────┐
│  FILTERS   │  TRACE TABLE (full width, partially obscured)      │
│            │                     ┌──────────────────────────────┐│
│  ...       │  ...                │  DRAWER (overlay, ~60%)     ││
│            │                     │                              ││
│            │                     │  ┌─ HEADER ──────────────┐  ││
│            │                     │  │ trace ID · name · ●   │  ││
│            │                     │  │ metrics pills         │  ││
│            │                     │  │ key: value labels     │  ││
│            │                     │  └───────────────────────┘  ││
│            │                     │  ┌─ MODE SWITCH ─────────┐  ││
│            │                     │  │ [Trace ↔ Conversation]│  ││
│            │                     │  └───────────────────────┘  ││
│            │                     │  ┌─ ALERTS (conditional) ┐  ││
│            │                     │  │ ⚠ contextual warnings │  ││
│            │                     │  └───────────────────────┘  ││
│            │                     │  ┌─ CONTEXT PEEK ────────┐  ││
│            │                     │  │ (if conversation)     │  ││
│            │                     │  └───────────────────────┘  ││
│            │                     │  ┌─ VISUALIZATION ───────┐  ││
│            │                     │  │ [Waterfall][Flame][SL] │  ││
│            │                     │  │ ...viz content...      │  ││
│            │                     │  └───────────────────────┘  ││
│            │                     │  ┌─ TAB BAR ─────────────┐  ││
│            │                     │  │ [Trace Summary] [Span]│  ││
│            │                     │  └───────────────────────┘  ││
│            │                     │  ┌─ ACCORDIONS ──────────┐  ││
│            │                     │  │ (content per tab)     │  ││
│            │                     │  └───────────────────────┘  ││
│            │                     └──────────────────────────────┘│
└────────────┴─────────────────────────────────────────────────────┘
```

### Drawer Maximised (full width)

Double-click the drawer header or click a maximise button to expand the drawer to full content width (filters + table hidden):

```
┌──────────────────────────────────────────────────────────────────┐
│  DRAWER (full width)                                [↙ restore] │
│                                                                  │
│  ┌─ HEADER ───────────────────────────────────────────────────┐  │
│  │ ...                                                        │  │
│  └────────────────────────────────────────────────────────────┘  │
│  ┌─ CONTEXT AREA (more horizontal space) ─────────────────────┐  │
│  │ ...                                                         │  │
│  └─────────────────────────────────────────────────────────────┘  │
│  ┌─ DETAIL TABS ──────────────────────────────────────────────┐  │
│  │ ...                                                         │  │
│  └─────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

## Icons

All PRDs use emoji shorthand (👤🤖🔧◈⚙◎ etc.) for readability in ASCII diagrams. The production implementation uses **Lucide React icons via Chakra UI** — not emoji. Map:

| PRD shorthand | Production icon | Usage |
|---|---|---|
| 👤 | `User` | User/human message |
| 🤖 | `Bot` | Assistant/AI message |
| 🔧 | `Wrench` | Tool call |
| ◈ | `Sparkles` | LLM span |
| ⚙ | `Cog` | Tool span |
| ◎ | `Target` | Agent span |
| ⊛ | `Search` | RAG span |
| ◉ | `Shield` | Guardrail span |
| ◇ | `Diamond` | Evaluation span |
| ○ | `Circle` | Generic span |
| ⚠ | `AlertTriangle` | Warning/error indicator |
| 📋 | `Copy` | Copy-to-clipboard |

This applies to all PRDs in this project (001-016).

## Unified Drawer Model

The drawer is always the same shell. Two modes (Trace and Conversation), plus span selection via a tab model.

| Mode | Header | Context Area | Accordions |
|---|---|---|---|
| **Trace** (no conversation) | Trace name, metrics, tags | Visualization (Waterfall/Flame/Span List) | Trace Summary tab: I/O, Attributes, Exceptions, Events, Evals |
| **Trace** (has conversation) | Trace name, metrics, "turn 3/6" | Context peek + Visualization | Trace Summary tab: I/O, Attributes, Exceptions, Events, Evals |
| **Conversation** | Conversation ID, aggregate metrics | Full conversation (all turns) | Conversation summary stats, combined evals |

The shell (width, close button, maximise button) is identical in both modes. Close button visible in top-right corner with Esc Kbd badge.

## Span Selection (Tab Model)

Span selection uses a **tab bar** between the visualization and the accordions. An "Trace Summary" tab is always present and shows trace-level data. Clicking a span in the visualization adds an ephemeral span tab.

```
No span selected:
┌──────────────────────────────────────────────────────┐
│  [Waterfall] [Flame] [Span List]                          │
│  ▼ agent.run                              2.3s       │
│    · llm.openai.chat  ██████████░░  1.1s             │
│      tool.search_db   ███░░░░░░░░░  0.3s             │
├──────────────────────────────────────────────────────┤
│  ┌──────────┐                                        │
│  │ Trace Summary │                                        │
│  ╘══════════╧════════════════════════════════════════╡
│  ▼ I/O                                               │
│  ▶ Attributes                                        │
│  ▶ Events (3)                                        │
│  ▶ Evals (2)                                         │
└──────────────────────────────────────────────────────┘

Span selected:
┌──────────────────────────────────────────────────────┐
│  [Waterfall] [Flame] [Span List]                          │
│  ▼ agent.run                              2.3s       │
│    ▸ llm.openai.chat  ██████████░░  1.1s  ← selected│
│      tool.search_db   ███░░░░░░░░░  0.3s             │
├──────────────────────────────────────────────────────┤
│  ┌──────────┐ ┌────────────────────────────────┐     │
│  │ Trace Summary │ │ llm.openai.chat  LLM  1.1s  × │     │
│  ╘══════════╛ ╘════════════════════════════════╧═════╡
│  ▼ I/O                                               │
│  ▼ Attributes                                        │
└──────────────────────────────────────────────────────┘
```

**Tab behavior:**
- **Trace Summary tab:** Always present. Shows trace-level data (I/O, Attributes, Exceptions, Events, Evals). Cannot be closed.
- **Span tab:** Appears when a span is clicked in the visualization. Shows span-level data (I/O, Attributes only — events and evals are hoisted to trace level). Shows span name, type badge, key metrics, and × to close.
- **Click span in viz:** Opens/activates the span tab. If a different span was already open, the tab updates to the new span.
- **Click same span again:** Closes the span tab, returns to Trace Summary.
- **Click × on span tab:** Closes the span tab, returns to Trace Summary.
- **Click Trace Summary tab:** Switches to Trace Summary. The span tab remains open — you can click back to it. This is a tab switch, not a close action.
- **Escape:** Closes the span tab (removes it), returns to Trace Summary.
- **Click empty space in viz:** Closes the span tab, returns to Trace Summary.

**Important:** The span tab is ephemeral — only one span tab exists at a time. It does not create a history/stack. The Trace Summary tab content never changes based on span selection.

**Persistent sections (not affected by tab switching):** The following drawer sections are always visible regardless of which tab is active:
- **Header** (trace name, metrics, tags) — always visible
- **Mode Switch** (Trace/Conversation toggle) — always visible when conversation exists
- **Contextual Alerts** (warnings, errors) — always visible in Trace mode
- **Context Peek** (prev/current/next turns) — always visible when trace has a conversation
- **Visualization** (Waterfall/Flame/Span List) — always visible

Only the **accordion content below the tab bar** changes when switching between Trace Summary and Span tabs. Everything above the tab bar is fixed.

## Mode Switch

When a trace belongs to a conversation, a toggle appears below the header:

```
┌──────────────────────────────────────────────────────┐
│  agent.run                    ● OK   2.3s   $0.004  │
│  finance-bot  ·  production  ·  v2.4.1    2 min ago │
│  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  │
│  [Trace]  [Conversation]                     turn 3 of 6  │
└──────────────────────────────────────────────────────┘
```

- **[Trace] / [Conversation]** — segmented toggle. Switches the context area and accordions.
- **"turn 3 of 6"** — shows position in the conversation. Only visible in Trace mode when conversation exists.
- If trace has no conversation: toggle is hidden. Only Trace mode available.
- Switching between Trace ↔ Conversation uses the fade animation on the content below the toggle.

### Trace Mode (with conversation — context peek)

When viewing a trace that belongs to a conversation, a compact context peek appears above the visualization:

```
┌──────────────────────────────────────────────────────┐
│  [Trace]  [Conversation]                     turn 3 of 6  │
│  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  │
│  CONVERSATION CONTEXT                                │
│  ┌────────────────────────────────────────────────┐  │
│  │  👤 "What if it's been more than 30 days?"  ← │  │
│  │▸ 🤖 "After 30 days, we offer store cred..." ● │  │
│  │  🔧 lookup_order("ORD-9821")                → │  │
│  └────────────────────────────────────────────────┘  │
│  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  │
│  [Waterfall] [Flame] [Span List]                          │
│  ...visualization...                                 │
│  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  │
│  [I/O]  [Events]  [Evals]                            │
│  ...detail tabs...                                   │
└──────────────────────────────────────────────────────┘
```

- Shows 3 turns: previous, current (highlighted ▸), next
- ← / → arrows navigate to adjacent turns (drawer updates with fade animation to that trace)
- Compact: 3 lines max, single-line snippets

### Conversation Mode

The conversation view shows the user-facing thread — what the human and AI said to each other, with the system machinery (tool calls, guardrails, agent orchestration) visible but subordinate. This is the view a product manager uses to understand what the user experienced.

#### Layout

```
┌──────────────────────────────────────────────────────┐
│  Conversation: thread_abc123               6 turns   │
│  👤3  🤖3  🔧4   ·   4.2s   ·   $0.008             │
│  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  │
│  [Trace]  [Conversation]                             │
│  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  │
│                                                      │
│  TURN 1                                   ▸ trace →  │
│  👤 "What's the refund policy for orders over $500?" │
│  🤖 "For orders over $500, our refund policy allo.." │
│     1.2s  $0.003  gpt-4o                             │
│  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  │
│     ⏱ +0.3s                                          │
│  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  │
│  TURN 2                                   ▸ trace →  │
│  👤 "What if it's been more than 30 days?"           │
│  🤖 "After 30 days, we offer store credit for th.." │
│     ▶ 🔧 lookup_order(ORD-9821) → { found: true }   │
│     2.2s  $0.004  gpt-4o                             │
│  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  │
│     ⏱ +12.4s ← long pause                           │
│  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  │
│  TURN 3                              ⚠    ▸ trace →  │
│  👤 "I need to speak to a manager"                   │
│  🤖 "I understand your frustration. Let me connec.." │
│     0.9s  $0.001  gpt-4o                             │
│                                                      │
├──────────────────────────────────────────────────────┤
│  ▶ Conversation Summary                              │
│  ▶ Events (5)                                        │
│  ▶ Evals (3)                                         │
└──────────────────────────────────────────────────────┘
```

#### Turn Structure

A **turn** is one trace in the conversation thread. It maps 1:1 to a trace — each trace in the conversation is one turn. The turn boundaries come from the trace boundaries in the data.

Each turn shows:

- **Turn number:** `TURN 1`, `TURN 2`, etc. Muted label.
- **User message (👤):** The input to this trace. Full message content, rendered using the same I/O renderer as PRD-005 (markdown support, data-driven detection). Truncated at ~300 chars with "Show full" expander.
- **Assistant response (🤖):** The output of this trace. Same rendering rules. Truncated at ~300 chars.
- **Tool calls (🔧):** Collapsed by default. Shows tool name + args summary + return value summary. Click ▶ to expand and see full tool I/O. If a turn has multiple tool calls, they're listed vertically within the turn. Tool calls are visually indented and muted — they're context, not the conversation.
- **Metrics line:** Duration, cost, model. Below the assistant response, muted text.
- **Error indicator (⚠):** If this turn's trace has an error status, show a red ⚠ on the turn header.
- **"▸ trace →" link:** Right-aligned on the turn header. Clicks to switch to Trace mode for this specific trace.

#### Between Turns

- **Time-between (⏱):** Shown between turns as a separator. This is the wall-clock gap between when one trace ended and the next started. Shows relative time: `⏱ +0.3s`, `⏱ +12.4s`, `⏱ +2m 30s`.
- **Long pauses:** If time-between exceeds 30s, highlight it: `⏱ +12.4s ← long pause` with a subtle yellow background on the separator. Long pauses between user messages often indicate confusion or the user doing something else.
- **No time-between for first turn:** The first turn has no separator above it.

#### Tool Calls Within Turns

A single turn (trace) may involve multiple LLM calls, tool invocations, guardrail checks, etc. The conversation view doesn't show all of these — it shows the user-visible exchange plus a collapsed summary of the machinery.

```
TURN 2                                        ▸ trace →
👤 "What if it's been more than 30 days?"
🤖 "After 30 days, we offer store credit for th.."
   ▶ System activity (3 spans)
      🔧 lookup_order(ORD-9821) → { found: true, days: 45 }
      🔧 check_policy(type: "refund") → { eligible: false }
      ◉ guardrail.pii_check → pass
   2.2s  $0.004  gpt-4o
```

- **"System activity (N spans)"** — collapsed group showing tool/guardrail/agent spans that happened during this turn. Only shows spans with types: tool, guardrail, rag. LLM spans are hidden (the user sees the output already). Agent/chain spans are hidden (orchestration noise).
- Each system activity item: type icon + name + args summary + return summary. One line each.
- Clicking any system activity span opens Trace mode for this turn with that span pre-selected in the span tab.
- If there are no tool/guardrail/rag spans, the "System activity" group is hidden entirely.

#### Conversation Header

```
┌──────────────────────────────────────────────────────┐
│  Conversation: abc12345               6 turns        │
│  👤3  🤖3  🔧4   ·   4.2s total  ·  $0.008 total   │
│  First: 10:23am  ·  Last: 10:31am  ·  Span: 8m 12s  │
└──────────────────────────────────────────────────────┘
```

- **Conversation ID:** Truncated to 8 chars, full ID on hover tooltip. Copy-to-clipboard button.
- **Message counts:** 👤 user messages, 🤖 assistant messages, 🔧 tool calls. Icons with counts.
- **Aggregate metrics:** Total duration (sum of all trace durations), total cost (sum of all trace costs).
- **Time span:** First message timestamp, last message timestamp, wall-clock span (last - first). This tells you how long the conversation lasted in real time, not just compute time.

#### Navigation Within Conversation

- **Scroll:** The conversation area is a scrollable container. All turns are rendered (not paginated). Scroll to navigate.
- **Jump-to-turn:** Click any turn number label to scroll that turn into view. For long conversations, a small jump menu appears in the conversation header: `Jump to: [turn selector ▾]`.
- **Keyboard:** Up/Down arrows scroll the conversation. Enter on a turn opens that trace in Trace mode.
- **Current turn indicator:** If you entered conversation mode from a specific trace, that turn is highlighted with a subtle left border and scrolled into view.

#### Long Conversations (20+ turns)

For conversations with many turns:

- All turns are rendered (no pagination). Virtual scrolling kicks in at 50+ turns to keep the DOM manageable.
- The turn numbers provide orientation: `TURN 1`, `TURN 2`, ... `TURN 47`.
- The jump-to-turn selector in the header becomes more prominent: a dropdown with turn numbers + first few words of each user message.
- **Collapse read turns:** A "Collapse earlier turns" control appears after the first 5 turns. Clicking it collapses turns 1-N into a summary line: `⋯ 15 earlier turns (collapsed)`. Click to expand. The most recent 5 turns are always visible.

#### Conversation Detail Accordions

Below the conversation area, the detail section shows conversation-level aggregations:

**Conversation Summary (default: open)**

```
┌──────────────────────────────────────────────────────┐
│  ▼ Conversation Summary                              │
│                                                      │
│  Turns     6                                         │
│  Duration  4.2s (compute) · 8m 12s (wall clock)      │
│  Cost      $0.008                                    │
│  Tokens    3,420 in · 2,180 out                      │
│  Models    gpt-4o (6 turns)                          │
│  Tools     lookup_order (2×), check_policy (1×)      │
│  Errors    1 (turn 5: RateLimitError)                │
│                                                      │
│  COST PER TURN                                       │
│  ┌────────────────────────────────────────────────┐  │
│  │ T1 ██ $0.003                                   │  │
│  │ T2 ████ $0.004                                 │  │
│  │ T3 █ $0.001                                    │  │
│  └────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────┘
```

- **Key-value summary:** Turn count, compute duration, wall-clock duration, total cost, total tokens (in/out), models used with turn counts, tools used with call counts, error count with turn reference.
- **Cost per turn chart:** Small horizontal bar chart showing cost distribution across turns. Helps identify which turns were expensive. Only shown if >2 turns and cost data exists.
- **Duration per turn chart:** Same format as cost chart, showing duration per turn. Helps identify slow turns. Only shown if >2 turns.

**Events accordion:** Shows all events across all turns in the conversation, in chronological order. Each event shows which turn it came from: `┈ from turn 2`. Same event card format as PRD-005 but with turn reference instead of span reference.

**Evals accordion:** Shows all evaluation results across all turns. Each eval shows which turn: `┈ from turn 3`. If the same eval type ran on multiple turns, they're listed separately (not aggregated) so you can see the score trajectory across the conversation.

#### Data Gating (Conversation Mode)

- **Single-turn conversation:** Show normally. It's a valid conversation that happens to have one turn. No special handling.
- **No user message in a turn:** Show assistant message only. Some traces are system-initiated (e.g., scheduled agent runs).
- **No assistant message in a turn:** Show user message + "No response generated" in muted text. The trace errored or timed out.
- **Turn with only tool calls (no user/assistant messages):** Show as a system turn: `⚙ System: lookup_order, check_policy` with collapsed details. This happens in agent workflows where intermediate traces are tool-only.
- **Missing trace data for a turn:** If a trace in the conversation can't be loaded: `Turn 3: Data unavailable` with muted text. Don't skip the turn number.
- **Conversation with 0 turns loaded:** "No traces found for this conversation." This shouldn't happen but handle it.

## Entry Points & Navigation

How you enter the drawer determines the initial mode:

| Entry point | Drawer opens in |
|---|---|
| Click a trace in All Traces preset | Trace mode |
| Click a trace in Errors preset | Trace mode (erroring span pre-selected → span selected) |
| Click a conversation header in Conversations preset | Conversation mode |
| Click an individual turn in Conversations preset | Trace mode (with conversation toggle visible) |
| Deep link to a trace | Trace mode |
| Deep link to a thread | Conversation mode |

**← Back** always returns to the table view you came from.

## Drawer Sections

| Section | PRD | All modes? |
|---|---|---|
| Header (name, status, metrics, tags) | PRD-008 | Yes (adapts per mode) |
| Mode Switch (Trace ↔ Conversation toggle) | This PRD | Only when trace has thread |
| Contextual Alerts | This PRD (below) | Trace mode only |
| Context Peek (prev/current/next turns) | This PRD | Trace mode with conversation only |
| Context Area (viz or conversation) | PRD-007, this PRD | Yes (adapts per mode) |
| Tab Bar (Trace Summary / Span) | This PRD (above) | Trace mode only |
| Detail Accordions (content depends on tab) | PRD-005, PRD-006, PRD-009 | Yes (adapts per mode) |

## Contextual Alerts

Rule-based alerts shown below the header. Phase 1 only — no AI. Only shown in Trace mode (not Conversation mode).

| Condition | Alert Text |
|---|---|
| Trace duration > 2x the 24h p50 for this service | "⚠ This trace is {X}x slower than the 24h average" |
| Trace has error status | "❌ Error: {error message}" |
| Prompt version mismatch (if detectable) | "⚠ Span used prompt v{X} but v{Y} is active" |

- Alerts are dismissible (X button)
- Maximum 2 alerts shown, "and N more" if additional
- Yellow background for warnings, red for errors

## Action Bar

Removed from Phase 1. The model indicator is already shown in the span tab label (PRD-006) and the drawer header metrics (PRD-008). Prompt-related actions (Open in Playground, Compare versions) will live inside a dedicated Prompt accordion section when PRD-010 is implemented in a future phase.

## Presence Avatars (future)

Not built in Phase 1. No reserved layout space — add it when the feature is real. Reserving 80px of dead whitespace for a feature that doesn't exist is bad design.

## Loading States (HTTP/2 streaming)

Data streams progressively over HTTP/2. Sections render as their data arrives, not all at once.

**Drawer open (streaming load):**
1. Drawer slides open immediately
2. **Header renders first** (trace metadata arrives first — name, status, metrics, tags)
3. **Visualization renders next** as spans stream in. Tree/waterfall/Flame builds incrementally — spans appear as they arrive. Early spans are interactive before all spans have loaded.
4. **Accordion sections populate** as I/O and event data streams in. Sections show skeleton shimmer until their data arrives, then content fades in.
5. Spans not yet attached to traces: render what's available, show "loading..." indicator for missing children

**Trace switch:** Old content fades out (opacity, ~100ms). New header renders immediately (trace metadata is fast). Visualization and accordions stream in progressively with fade-in.

**Filter application:** Table dims to 60% opacity during re-query. New results stream in and replace the dimmed rows. Facet counts update as results arrive.

**Error states:**
- Failed to load trace data: "Failed to load trace data" with Retry button. Drawer stays open.
- Trace deleted/not found: "This trace no longer exists" with Close button.
- Partial load failure (e.g., spans loaded but I/O failed): show what loaded, error message in the failed section with Retry for that section only.

## Animation & Transitions

- **Open:** Fade in (`opacity: 0→1`) + subtle translate (`translateX(8px)→0`), ~250ms ease-out. Not a full slide — just a gentle nudge from the right as it fades in. CSS only.
- **Close:** Fade out (`opacity: 1→0`) + subtle translate (`0→translateX(8px)`), ~200ms ease-in. Mirrors the open.
- **Maximise/Restore:** Width transition, ~200ms
- **Content switch (trace switch, mode switch):** Drawer shell stays in place. Content does a smooth CSS fade: `opacity: 0` (~100ms ease-out) → new content `opacity: 1` (~150ms ease-in). No scale, no bounce. Simple, clean.
- **Tab switch (Trace Summary ↔ Span):** Same fade animation as content switch. Accordion content fades out/in when switching between Trace Summary and span tabs.
- **Same fade animation** for: switching traces, switching Trace ↔ Conversation mode, switching Trace Summary ↔ Span tab.

## Navigation & Keyboard

See PRD-011 for the canonical **Focus Zone Model** that resolves all keyboard shortcut conflicts across the product. Key drawer shortcuts:

- **Escape:** Cascade: (1) If flame graph is zoomed, zoom out one level. (2) If span tab is open, close it (return to Trace Summary). (3) If no span tab, close drawer. (4) If no drawer, unfocus search bar. Each press moves one step down the cascade.
- **J/K:** Navigate to previous/next trace in the list (drawer updates with fade animation). Uses J/K instead of Up/Down because Up/Down are zone-scoped to span navigation within the viz.
- **[ / ]:** Navigate to prev/next conversation turn in the context peek. Uses brackets instead of Left/Right because Left/Right are zone-scoped to tree collapse/expand within the viz.
- **1/2/3:** Switch visualization tabs (Waterfall/Flame/Span List) — Trace mode only
- **T:** Toggle between Trace and Conversation mode (when thread exists)
- **O:** Switch to Trace Summary tab (when span tab is open)

## Deep Linking

Drawer state is reflected in the URL:

```
/observe                                  Observe page, default view
/observe?trace=abc123                     Drawer open, Trace Summary tab
/observe?trace=abc123&mode=conversation   Drawer open, conversation mode
/observe?trace=abc123&span=def456         Drawer open, span tab for def456
/observe?trace=abc123&viz=waterfall       Waterfall visualization active
/observe?trace=abc123&tab=events          Events accordion expanded
/observe?thread=xyz789                    Drawer open, conversation mode directly
/observe?from=now-1h&to=now              Time range in URL (see PRD-003)
/observe/live                             Live Tail (see PRD-015)
```

Loading a URL with these params opens the page with the drawer already open and the correct state.

## Responsive Behavior

Uses Chakra v3 container queries (not viewport media queries) so the layout adapts based on the content area's actual width, not the window. This means the layout responds correctly when sidebars, panels, or other app chrome change the available space.

- **Container ≥1400px:** Full three-column layout (filters + table + drawer)
- **Container 1200-1399px:** Filter column auto-collapses when drawer opens. Two columns (table + drawer).
- **Container 1024-1199px:** Table + Drawer (narrower). Table shows fewer columns. Filter sidebar collapsed by default.
- **Container <1024px:** Drawer goes full-width when open. Table is hidden. Back button returns to table. Filter sidebar is a slide-over overlay.

See PRD-011 for full breakpoint spec and column priority order.

## State: Navigation

The drawer has two navigation levels (not a deep stack):

| Level | What | How to get there |
|---|---|---|
| Trace mode | Trace detail + visualization + tab bar + accordions | Click trace in table, or click turn in conversation mode |
| Conversation mode | Full conversation view | Click conversation header, or click "Conversation" toggle |

**Span selection is NOT navigation.** It's a tab within Trace mode. The Trace Summary tab always shows trace-level data. The span tab shows span-level data. Switching tabs doesn't create history — no back button needed.

**← Back** in the drawer returns to the table. The Trace ↔ Conversation toggle switches between modes (no back button needed, it's a toggle).

See PRD-005 (Trace View / Trace Summary tab) and PRD-006 (Span View / Span tab) for what the accordions show in each tab.
