# PRD-016: Multiplayer Presence

Parent: [Design: Trace v2](../design/trace-v2.md)
Status: DRAFT
Date: 2026-04-23

## What This Is

Contextual presence indicators showing which teammates are looking at the same things you are. Not global "who's online" — presence follows the data hierarchy: view, trace, span.

This is a PoC mock to validate the concept visually before committing to real-time infrastructure (Liveblocks/WebSocket). No observability vendor ships multiplayer. This is whitespace.

## Why Contextual, Not Global

"Sarah is somewhere in Observe" is noise. "Sarah is looking at this trace right now" is signal. Presence is only meaningful when scoped to your current context.

The presence hierarchy mirrors the data hierarchy:

```
View/Lens level  →  "2 others on this view"
  Trace level    →  dot on the row — someone has this trace open
    Drawer       →  "Also viewing" — someone else is in this drawer
      Span level →  dot on the span — someone is focused here
```

Each level is independently meaningful. You only see presence for people in the same context as you.

## Presence Levels

### 1. View-Level (Preset Tabs)

Shows teammates on the same lens/preset. Positioned right-aligned in the preset tab bar, after the tab labels.

```
 All Traces  Conversations  Errors    (SJ)(AR)(MK) on this view     [compact/comfy]
 ────────                              ──────────────────────
```

- Overlapping avatar circles (22px in tab bar for visual weight, 20px elsewhere, -8px overlap)
- Each circle: team member's initials in their assigned color
- "on this view" label in muted text (gray.600)
- Tooltip on each avatar: "{name} — viewing this lens"
- Only shows people on the SAME preset — switching to Errors shows different avatars
- Max 3 visible + overflow counter (+2)

### 2. Trace-Level (Table Rows)

A single colored dot on rows where someone has that trace open. On hover, individual avatars fan out from the dot.

```
Default (collapsed):
┌──────────────────────────────────────────────────────────────────┐
│  2m  ● agent.run     finance-bot    1.2s  $0.003  1.2K   4o    │
│        ↑ "Analyze the Q3 revenue..."                            │
│        ↓ "Based on the Q3 data..."                              │
└──────────────────────────────────────────────────────────────────┘
       ^
       presence dot (8px, first viewer's color, subtle glow)

Hover (expanded):
┌──────────────────────────────────────────────────────────────────┐
│  2m (SJ)(AR) agent.run  finance-bot  1.2s  $0.003  1.2K   4o   │
│        ↑ "Analyze the Q3 revenue..."                            │
│        ↓ "Based on the Q3 data..."                              │
└──────────────────────────────────────────────────────────────────┘
       ^^^^^^^^
       avatars slide out with spring animation (~200ms)
       each shows initials, tooltip shows full name
```

**Dot placement:** Left side of the row, before the timestamp column. The dot sits 8px inset from the left edge. On error rows, the 3px error border occupies the outermost left edge — dot and border do not overlap.

**Ordering:** "First viewer" = array order in `mockPresence`. For real-time: earliest arrival time.

**Fan-out animation:**
- Default: single 8px dot (first viewer's color), subtle box-shadow glow
- Hover: dot fades, individual 20px avatar circles slide out horizontally
- `transform: translateX` with spring easing `cubic-bezier(0.34, 1.56, 0.64, 1)`, ~200ms
- Each avatar staggers by 30ms
- Mouse leave: avatars slide back into single dot (reverse animation)
- Tooltip on each expanded avatar: full name
- Fan-out uses absolute/overlay positioning — does not affect row height or trigger table reflow

### 3. Drawer-Level (Drawer Header)

When someone else has the same trace open, show their avatar(s) + "Also viewing" in the drawer header.

```
┌───────────────────────────────────────────────────────────────┐
│ trace: abc12345  📋                                           │
│ agent.run                  ● ok                               │
│ ⏱ 2.3s  💰 $0.004  📊 1.2K↑ 380↓  🤖 gpt-4o                │
│ service: finance-bot · env: production · 2m ago               │
│                                                               │
│                            (SJ)(AR) Also viewing    [⤢] [X]  │
└───────────────────────────────────────────────────────────────┘
                             ^^^^^^^^^^^^^^^^^^^^^^
                             20px avatars + muted label
                             between trace info and controls
```

- Avatar circles (20px) with initials
- "Also viewing" text in gray.500, fontSize 11px
- Positioned in the header actions area, left of maximize/close buttons
- Multiple viewers: overlapping stack with -6px overlap
- Only shows OTHER viewers (not you)

### 4. Span-Level (Inside Drawer)

Same dot pattern as trace rows. When someone is focused on a specific span in the tree/waterfall, show a colored dot next to that span's name.

```
Service / Span                          │  Timeline
─────────────────────────────────────────│──────────────
▼ ● 🤖 agent.run                        │  ████████████
  ● ▼ 💬 llm.openai.chat                │    ██████
    ▶ 🔧 tool.fetch_report              │      ██
  ▶ 💬 llm.summarize                    │        ████
  ▶ 🛡 guardrail.toxicity_check         │             █
      ^
      presence dot (8px, viewer's color)
      hover to see who
```

- 8px dot in the span row, positioned before the expand/collapse toggle
- Same hover-to-reveal behavior as trace rows (fan-out to 20px avatars)
- Shows who is focused on that specific span (has it selected in the drawer)

## Mock Data

### Team Members

| ID | Name | Initials | Color | Notes |
|----|------|----------|-------|-------|
| user-sj | Sarah Jensen | SJ | `#ED64A6` (pink) | Viewing trace-001, focused on span s1-llm1 |
| user-ar | Alex Rivera | AR | `#38B2AC` (teal) | Viewing trace-001, focused on span s1-root |
| user-mk | Mike Kim | MK | `#76E4F7` (cyan) | On All Traces view, no trace open |
| user-ps | Priya Sharma | PS | `#F6AD55` (amber) | Viewing trace-003 |
| user-jl | Jordan Lee | JL | `#B794F4` (light purple) | On Errors preset |

**Color rationale:** Distinct from span type colors (blue=LLM, green=tool, purple=agent, orange=RAG, yellow=guardrail, gray=generic, red=error). Team member colors use pink, teal, cyan, amber, light purple — warm/personal tones that read as "people" not "data."

### Presence Assignments

| Member | Preset | Trace | Span | Status |
|--------|--------|-------|------|--------|
| Sarah Jensen | all | trace-001 | s1-llm1 | active |
| Alex Rivera | all | trace-001 | s1-root | active |
| Mike Kim | all | — | — | active |
| Priya Sharma | all | trace-003 | — | active |
| Jordan Lee | errors | — | — | active |

**What you see in each context:**
- On "All Traces" preset: SJ, AR, MK, PS avatars in tab bar (4 on this view). JL is on Errors.
- On trace-001 row: dot (SJ's pink). Hover: SJ + AR fan out.
- On trace-003 row: dot (PS's amber). Hover: PS avatar.
- Open trace-001 drawer: "SJ, AR Also viewing" in header.
- Inside trace-001, span s1-llm1: dot (SJ's pink).
- Inside trace-001, span s1-root: dot (AR's teal).
- Switch to "Errors" preset: only JL avatar in tab bar.

## Data Types

```typescript
interface TeamMember {
  id: string;
  name: string;
  initials: string;
  color: string; // hex
}

interface PresenceEntry {
  userId: string;
  preset: PresetTab;
  traceId?: string;
  spanId?: string;
  status: 'active' | 'idle';
}
```

Types are shaped to align with Liveblocks' `User` and `Presence` patterns for future migration.

## Interaction States

| State | What Happens |
|-------|-------------|
| 0 viewers on your view | No avatars shown in tab bar |
| 0 viewers on a trace | No dot on that row |
| 1 viewer on a trace | Single dot in their color |
| 2+ viewers on a trace | Single dot (first viewer's color), hover fans out all |
| You open a trace someone is viewing | "Also viewing" appears in drawer header |
| Teammate leaves the trace | Their avatar disappears (mock: static, no transition) |
| Row with presence dot + error status | Dot coexists with error left-border; dot is inside the row, border is on the edge |

## What's NOT in This PRD

- Real-time infrastructure (WebSocket, Liveblocks, CRDT) — Phase 5b
- Comments on traces
- @mentions and notifications to Slack
- Activity feed / recent team actions
- Share trace button / deep links
- Idle/active state transitions (mock is static)
- Cursor tracking (not useful in a hierarchical UI — that's for spatial canvases like Figma)

## Files Touched

- `types/index.ts` — TeamMember, PresenceEntry types
- `data/mockData.ts` — mockTeamMembers, mockPresence arrays
- `App.tsx` — wire presence props, view-level avatars in tab bar
- `TraceTable.tsx` — presence dots on rows with fan-out animation
- `TraceDrawer.tsx` — "Also viewing" in header
- `WaterfallView.tsx` — span-level presence dots

## Success Criteria

- Looking at the mock, a viewer immediately understands "other people are here"
- The contextual scoping feels natural — presence appears where relevant, not everywhere
- Avatar colors are distinguishable from span type colors
- Fan-out animation feels polished, not janky
- No visual clutter — presence indicators are subtle when collapsed
