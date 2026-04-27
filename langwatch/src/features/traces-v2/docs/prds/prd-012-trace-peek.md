# PRD-012: Trace Peek

Parent: [Design: Trace v2](../design/trace-v2.md)
Status: DRAFT
Date: 2026-04-22

## What This Is

A lightweight preview that lets you peek into a trace without opening the drawer or changing what's currently in the drawer. The peek uses a two-step intentional trigger (hover → enter pull-tab) so it never fires accidentally. This is critical for triage: you have a trace open in the drawer, but want to quickly scan adjacent traces to compare or find the right one.

## Activation (Pull-Tab Trigger)

The peek uses a **two-step intentional trigger** to avoid accidental activation:

1. **Hover a row** — nothing moves, nothing changes. Normal hover highlight only.
2. **After ~1s**, a small pull-tab slides out from the bottom edge of the row, overlapping onto the row below. The tab is subtle — a small rounded nub (~60px wide, ~16px tall) with a down-chevron or subtle "peek" label.
3. **Move cursor into the pull-tab** — the peek panel unfolds from the tab with a smooth animation. The tab is the trigger zone; if you move your cursor past it to the next row, the tab on the first row fades and the next row's tab starts its hover timer.

```
STEP 1 — Hover row (nothing changes):
┌──────────────────────────────────────────────────────────────┐
│  2m    agent.run     finance    1.2s  $0.003  ● OK          │
│        ↑ "What's the refund policy for orders…"              │
│        ↓ "For orders over…"                                  │
├──────────────────────────────────────────────────────────────┤
│  5m    tool.search   fraud     0.3s  $0.000  ● OK           │

STEP 2 — After ~1s hover, pull-tab appears:
┌──────────────────────────────────────────────────────────────┐
│  2m    agent.run     finance    1.2s  $0.003  ● OK          │
│        ↑ "What's the refund policy for orders…"              │
│        ↓ "For orders over…"                                  │
├─────────────────────────────────────┤╭──────╮├───────────────┤
│  5m    tool.search   fraud     0.3s │  ▾   ││$0.000  ● OK  │
                                      ╰──────╯
                                      pull-tab (overlaps row below)

STEP 3 — Cursor enters pull-tab, peek unfolds:
┌──────────────────────────────────────────────────────────────┐
│  2m    agent.run     finance    1.2s  $0.003  ● OK          │
│        ↑ "What's the refund policy for orders…"              │
│        ↓ "For orders over…"                                  │
├──────────────────────────────────────────────────────────────┤
│  ┌────────────────────────────────────────────────────────┐  │
│  │  agent.run                  ● OK    ⏱ 2.3s  💰 $0.004│  │
│  │  finance-bot · production · 2 min ago                 │  │
│  │  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ │  │
│  │  INPUT                                                │  │
│  │  "What's the refund policy for orders over $500?"     │  │
│  │  OUTPUT                                               │  │
│  │  "For orders over $500, our refund policy allows a    │  │
│  │   full return within 30 days…"                        │  │
│  │  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ │  │
│  │  ● Faith 8.2  ● Toxic ✓   ·   2 events  ⚠           │  │
│  │  3 spans: llm ×2, tool ×1                            │  │
│  │                                  [Open in drawer →]   │  │
│  └────────────────────────────────────────────────────────┘  │
├──────────────────────────────────────────────────────────────┤
│  5m    tool.search   fraud     0.3s  $0.000  ● OK           │
```

**Why two steps:** Hovering rows is constant — you can't avoid it while using the table. A hover-only trigger would fire constantly. The pull-tab creates an intentional second action: you have to move your cursor *into* the tab, which you'd never do by accident while scanning rows. The tab appears below the row, out of the natural horizontal scan path.

**Pull-tab direction:** Normally appears below the row. If the row is near the bottom of the viewport, the tab appears above the row and the peek unfolds upward.

**Pull-tab timing:** Tab appears after ~1s of continuous hover on the same row. If you're scanning quickly between rows (hover < 1s), no tabs appear. This prevents visual noise during fast scanning.

## Peek Panel

The peek unfolds **inline in the table**, overlaying the rows below (or above) the hovered trace. It does NOT replace the drawer and does not affect the drawer's content. The peek sits at a higher z-index than the table rows but below the drawer.

```
FULL PAGE WITH PEEK OPEN (drawer also open):
┌────────────┬──────────────────────┬──────────────────────────┐
│  FILTERS   │  TRACE TABLE         │  DRAWER (unchanged)      │
│            │                      │                           │
│            │  agent.run  ● OK ... │  (still showing whatever │
│            │  ↑ "What's the…"     │   trace was open before  │
│            │  ↓ "For orders…"     │   — not affected by peek)│
│            │  ┌── PEEK ────────┐  │                           │
│            │  │ agent.run ● OK │  │                           │
│            │  │ finance · prod │  │                           │
│            │  │ ⏱2.3s 💰$0.004│  │                           │
│            │  │ ─ ─ ─ ─ ─ ─ ─ │  │                           │
│            │  │ INPUT          │  │                           │
│            │  │ "What's the…"  │  │                           │
│            │  │ OUTPUT         │  │                           │
│            │  │ "For orders…"  │  │                           │
│            │  │ ─ ─ ─ ─ ─ ─ ─ │  │                           │
│            │  │ ●F 8.2 ●T ✓   │  │                           │
│            │  │ 2 events ⚠    │  │                           │
│            │  │ 3 spans       │  │                           │
│            │  │ [Open drawer→]│  │                           │
│            │  └────────────────┘  │                           │
│            │  (rows below hidden  │                           │
│            │   behind peek)       │                           │
└────────────┴──────────────────────┴──────────────────────────┘
```

The peek overlays the rows below — it doesn't push them down or rearrange the table. When dismissed, the rows are simply visible again.

## Peek Content

The peek is a compact, read-only summary. No accordions, no tabs, no interaction beyond reading and dismissing. Everything visible at once, no scrolling needed for typical traces.

### Sections (all visible, no collapse)

| Section | Content |
|---|---|
| **Header** | Root span name, status dot, service, environment, relative time |
| **Metrics** | Duration, cost, tokens (split), TTFT, model |
| **I/O** | Computed input + output (truncated ~200 chars each). Full text, not single-line snippets. |
| **Evals** | Compact badges: `● [name] [score/✓/✗]`. All evals shown (no overflow — peek has room). |
| **Events** | Count + notable event names. Exceptions highlighted: `⚠ RateLimitError`. |
| **Span summary** | Span count + type breakdown: `3 spans: llm ×2, tool ×1` |
| **Footer** | [Open in drawer] button + Esc Kbd badge |

### What the peek does NOT show

- No visualization (tree/waterfall/flame) — too complex for a peek
- No full attributes — too much data
- No span-level detail — trace-level only
- No eval reasoning/detail text — just name + score
- No conversation context — just this trace

## Behavior

### Dismissing the peek

- **Move cursor out of the peek panel** — peek collapses back with a reverse animation (~200ms)
- **Click [Open in drawer]** — peek closes, drawer opens with that trace
- **Click the source row** (above the peek) — same as [Open in drawer]
- **Escape** — peek collapses
- **Click anywhere else** — peek collapses

The peek is ephemeral — it exists only while you're actively looking at it. Moving your cursor away dismisses it naturally.

### Peek does NOT follow between rows

Unlike Quick Look, the peek does NOT auto-follow when you move to a different row. Each peek is a standalone action: hover row → tab appears → enter tab → peek opens → leave peek → peek closes. To peek another row, repeat the process. This keeps it simple and avoids confusing "sticky" behavior.

### Peek + Drawer coexistence

- The peek overlays table rows but sits below the drawer in z-index
- The drawer is NOT affected by peek — it stays showing whatever trace was already open
- Clicking [Open in drawer] in the peek opens that trace in the drawer and closes the peek
- This means you can compare: drawer shows trace A, peek shows trace B side by side (if the table is wide enough for the peek to be visible next to the drawer)

### Peek + Conversation context

If the peeked trace belongs to a conversation, show a subtle indicator in the peek header:

```
│  agent.run                  ● OK   │
│  finance-bot · production · 2m     │
│  Conversation thread_abc · turn 3/6│
```

No full conversation view in the peek — just the indicator. [Open in drawer] opens the full trace with conversation toggle available.

## Peek Panel Positioning & Animation

- Peek unfolds from the pull-tab, expanding downward (or upward if near viewport bottom)
- The animation should feel like the peek is being "pulled out" from the row — a smooth expand/reveal (~250ms ease-out)
- Collapse is the reverse animation (~200ms ease-in)
- Panel width: full width of the table column area
- Panel height: auto, based on content (typically ~250-350px)
- Subtle drop shadow on the peek panel to separate it from the rows it overlays
- Background: slightly elevated surface color (card-like)

## Data Fetching

The peek needs more data than the table row shows, but less than the full drawer.

- **From the table query (already loaded):** name, metrics, status, service, I/O preview, eval scores (if columns enabled), event count
- **Fetched on peek open:** If eval scores or event names aren't already in the table data, fetch the trace summary for this specific trace. This is a single lightweight query.
- **NOT fetched:** Full span data, full I/O content, eval reasoning, attributes, conversation context. These are only fetched when the drawer opens.

If the table already has all the data (all relevant columns were enabled), the peek is instant — no network request needed.

## Keyboard

| Key | Action |
|---|---|
| **Shift+Enter** | Open peek for the focused table row (keyboard activation) |
| **Escape** | Close peek |
| **Enter** | Open peeked trace in drawer, close peek |
| **T** | If trace has conversation: open in drawer in Conversation mode, close peek |

The primary trigger is the pull-tab (mouse interaction). `Shift+Enter` provides keyboard-only activation for accessibility — when a table row is focused via Up/Down arrows, `Shift+Enter` opens the peek instead of the drawer (`Enter` alone opens the drawer).

## Loading State

- If data needs to be fetched: peek panel appears immediately with header (from table data), body shows subtle shimmer for ~100-200ms until summary data loads
- If data is already available: peek appears instantly, no loading state

## Data Gating

- **Trace with no I/O:** I/O section shows "No input/output captured" in muted text
- **Trace with no evals:** Evals section hidden (not "no evals" — just absent)
- **Trace with no events:** Events section hidden
- **Non-LLM trace:** TTFT hidden, tokens hidden, model hidden

## Phase

Phase 1 — this is a core navigation feature, not a nice-to-have. Quick scanning is essential for triage workflows where users are looking through many traces to find the problematic one.
