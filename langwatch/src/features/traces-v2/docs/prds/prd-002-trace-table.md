# PRD-002: Trace Table

Parent: [Design: Trace v2](../design/trace-v2.md)
Status: DRAFT
Date: 2026-04-22

## What This Is

The primary data table showing traces. Sits in the center column between the filter panel (left) and the trace drawer (right, when open).

## Full Page Layout

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ [LangWatch]  Observe  Live Tail                                             │
├──────────────────────────────────────────────────────────────────────────────┤
│ 🔍 @origin:application @status:error ...                    [/] [Clear all] │
├──────┬───────────────────────────────────────────────────────────────────────┤
│ « F  │  All │ Conv │ Errors │ ByModel  Group:flat▾ ⏱Last24h▾ ≡≡ Col▾ +sim │
│ ──── │ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ │
│ ORIG │                                                                      │
│ ●App │  Time  Trace                       Dur   Cost  Tokens  Model        │
│ ○Sim │        agent.run              finance-bot                           │
│ ○Evl │  2m    ↑ "What's the refund..." 1.2s  $0.003  1.2K   4o           │
│ ──── │        ↓ "For orders over $5..."                                    │
│ STAT │▸ 5m    tool.search_db  research  0.3s  $0.000  --    --            │
│ ●Err │                                                                      │
│ ☐Wrn │                                                                      │
│ ☐OK  │                                           Page 1 of 12 [< >]       │
│ ──── │                                                                      │
│ TYPE │                                                                      │
│ ☐Agt │                                                                      │
│ ☐LLM │                                                                      │
└──────┴───────────────────────────────────────────────────────────────────────┘
```

**Sidebar states:**
- **Expanded (220px):** Full facet sections with three-stage checkboxes. `«` collapse button top-right.
- **Collapsed (40px):** Section abbreviations (O, S, T, Sv, M, Tk, $, Lt) with colored active-filter dots. `»` expand button. Click any abbreviation to expand.
- **Filter chip bar:** When collapsed + filters active, horizontal chip bar appears between toolbar and table.

## Origin Filter

Origin is the first facet in the filter sidebar, not a separate control above the table. It's just another filter dimension, but placed first because it's the most fundamental ("what kind of data am I looking at?").

- **Three values:** Application, Simulation, Evaluation — with count badges
- **Placement:** First section in the filter sidebar, above Status
- **Visual emphasis:** Slightly more prominent than other facets (subtle background tint or separator below) to signal importance, but structurally identical — same checkboxes, same counts, same two-way sync with search bar
- **Default:** None selected (shows all origins)
- **Multi-select:** Can check multiple (Application + Simulation)
- **Search bar sync:** Checking "Application" adds `@origin:application` to query
- **Origin-specific facets:** When an origin is selected, additional facets appear below the standard ones:
  - Simulation: adds Scenario, Verdict (Pass/Fail) facets
  - Evaluation: adds Eval Type, Score Range facets
  - Application: standard facets only
  - These are additive — standard facets always remain

## Toolbar Strip

The toolbar is a single horizontal strip below the search bar containing all table-level controls at a consistent 26px height:

```
│ View Tabs... │ Group: flat ▾ │ ⏱ Last 24h ▾ │ ≡ ≡≡ │ Columns ▾ │ + sim │
```

All controls share: `h="26px"`, `bg="#1a2030"`, `border="1px solid #2d3748"`, `borderRadius="sm"`, `fontSize="11px"`. Consistent gap between controls (`gap={1.5}`).

**Controls (left to right):**
1. **View tabs** — lens/preset tabs (flex, takes remaining space)
2. **Grouping selector** — dropdown with checkmark on selected item (not radio circles)
3. **Time range picker** — relative presets + absolute date/time, timezone display, copy button
4. **Density toggle** — compact/comfortable segmented control
5. **Columns** — dropdown with visibility checkboxes + drag-to-reorder handles
6. **+ sim** — dev button, far right, de-emphasized

## Lens Tabs

Multiple tabs for different view presets. Each reconfigures the table in place (no page navigation). Each preset is a combination of: filters applied, columns shown, grouping mode, sort order, and row display format.

**Preset-Filter Interaction:** When a preset is active, the filters that *define* that preset are locked (greyed out or hidden) in the filter column. Filters that *refine within* that preset remain active.

### 1. All Traces (default)

- Flat list, no grouping
- All default columns visible
- Sorted by timestamp descending
- No filters locked — full filter column available

### 2. Conversations

- Traces grouped by conversation ID (ThreadId field in data, or `gen_ai.conversation.id` from span attributes)
- Each group is a conversation row showing aggregate data
- Expand/collapse groups (collapsed by default, click to expand)
- Traces without a conversation ID are not shown in the Conversations preset (they have no conversation to group into). Users see them in All Traces.
- **Locked filters:** Conversation-related filters are collapsed and locked. The section heading shows a lock icon and the active value: `🔒 Status: set by Conversations`. Hover tooltip on the section heading: "This filter is set by the Conversations view. Switch to All Traces to change it." The section cannot be expanded while locked.
- Sorted by most recent message timestamp descending (most recently active conversations first)

#### Collapsed Conversation Row (default)

Each conversation is one row in the table when collapsed. The row shows enough summary data to decide which conversations to investigate.

```
┌────────────────────────────────────────────────────────────────────────────┐
│ Conversation     Last Message            Turns  Dur     Cost   Status     │
│ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ │
│ ▶ abc12345  2m   "I need to speak to..." 6      4.2s   $0.008   OK       │
│    👤3 🤖3 🔧4 · gpt-4o · finance-bot   wall: 8m 12s                    │
│                                                                            │
│ ▶ def45678  15m  "Thanks, that helped"   4      1.1s   $0.002   OK       │
│    👤2 🤖2 🔧1 · gpt-4o · support-bot   wall: 2m 03s                    │
│                                                                            │
│ ▶ ghi78901  1h   "Error: could not pr..."8      6.3s   $0.012  ● Error   │
│    👤4 🤖3 🔧5 · gpt-4o · research      wall: 15m 41s                   │
│                                                                            │
│ (traces without conversation ID not shown in this view)                   │
└────────────────────────────────────────────────────────────────────────────┘
```

**Conversation row — line 1 (header):**
- **▶/▼ expand toggle**
- **Conversation ID:** Truncated to 8 chars, copy-to-clipboard on click, full ID on hover
- **Relative time:** When the most recent message happened (2m, 15m, 1h)
- **Last message snippet:** The last user or assistant message, truncated to ~40 chars. Gives immediate context for what the conversation is about.
- **Turns:** Total trace count in the conversation
- **Duration:** Sum of compute duration across all traces
- **Cost:** Sum of cost across all traces
- **Status:** Worst status across all traces (if any trace errored, show ● Error)

**Conversation row — line 2 (summary):**
- **Message counts:** 👤 user, 🤖 assistant, 🔧 tool — with counts
- **Model:** Most-used model across the conversation (if mixed: `gpt-4o +1`)
- **Service:** Service name (if consistent across traces)
- **Wall-clock duration:** Time from first trace start to last trace end. This is how long the user spent in the conversation, not just compute time. Shows as `wall: 8m 12s`.

#### Expanded Conversation (click ▶)

```
┌────────────────────────────────────────────────────────────────────────────┐
│ ▼ abc12345  2m   "I need to speak to..." 6      4.2s   $0.008   OK       │
│    👤3 🤖3 🔧4 · gpt-4o · finance-bot   wall: 8m 12s                    │
│ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ │
│   T1  👤 "What's the refund policy for..."  🤖 "For orders ov..." 1.2s  │
│       ⏱ +0.3s                                                             │
│   T2  👤 "What if it's been more than..."   🤖 "After 30 days.." 2.2s  │
│       🔧 lookup_order, check_policy                                       │
│       ⏱ +12.4s ← long pause                                              │
│   T3  👤 "I need to speak to a manager"     🤖 "I understand.."  0.9s  │
│       ⏱ +0.1s                                                             │
│       ... 3 more turns                                        [Show all]  │
└────────────────────────────────────────────────────────────────────────────┘
```

**Expanded turn rows:**
- **Turn number:** `T1`, `T2`, etc. Compact label.
- **User message + Assistant message on same line:** Both truncated to ~30 chars each. Shows the exchange at a glance. If either is missing, that slot shows `—`.
- **Tool calls:** If the turn involved tool calls, show tool names on a second line: `🔧 lookup_order, check_policy`. Collapsed, just names.
- **Duration:** Right-aligned, for this trace only.
- **Time-between (⏱):** Between turns. Long pauses (>30s) highlighted: `⏱ +12.4s ← long pause`.
- **Max 5 turns shown.** If more: `... N more turns` with `[Show all]` link to expand fully.
- **Click any turn row:** Opens the trace drawer in Trace mode for that specific trace, with the Conversation toggle visible.
- **Click the conversation header row:** Opens the trace drawer in Conversation mode (full conversation view, see PRD-004).

#### Conversation Columns

The Conversations preset uses a different column set than All Traces:

| Column | Min Width | Content |
|---|---|---|
| Conversation | 280px | ID + expand toggle + last message snippet |
| Turns | 60px | Turn count |
| Duration | 80px | Sum of compute duration |
| Cost | 80px | Sum of cost |
| Tokens | 80px | Sum of tokens (in+out) |
| Model | 100px | Most-used model |
| Service | 120px | Service name |
| Status | 70px | Worst status indicator |

These are the default columns. Users can add/remove via the column selector (same mechanism as All Traces). Eval columns can be added — they show the conversation-level aggregation (e.g., average faithfulness score across turns).

#### Empty State

If no conversations exist in the current time range / filter set:
```
No conversations found.
Conversations appear when traces include a conversation ID (ThreadId or gen_ai.conversation.id).
```

### 3. Errors

- Filter: only traces with error status
- Two-line rows: first line = trace info, second line = erroring span + exception
- Sorted by timestamp descending
- **Locked filters:** Status facet collapsed and locked. Section heading: `🔒 Status: Error (set by Errors view)`. Hover tooltip: "This filter is set by the Errors view. Switch to All Traces to change it." Cannot be expanded while locked.
- If no errors: inline empty state "No errors in the selected time range"

```
┌──────────────────────────────────────────────────────────────────────┐
│  Time   Name                Service       Dur    Cost    Model     │
│ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─│
│● 2m    agent.run            finance-bot   1.2s   $0.003   gpt-4o  │
│  ╰ ▸ llm.openai.chat — RateLimitError: Rate limit exceeded for... │
│                                                                      │
│● 8m    rag.retrieve         research      4.1s   $0.000           │
│  ╰ ▸ tool.search_docs — TimeoutError: Document search timed out..│
│                                                                      │
│● 15m   llm.openai.chat     support-bot   0.3s   $0.001   gpt-4o  │
│  ╰ ▸ (root) — ContextLengthExceeded: max context length is 128K..│
│                                                                      │
│● 1h    agent.plan                         2.8s   $0.004   cl-son  │
│  ╰ ▸ tool.validate — ValidationError: Output schema mismatch...   │
└──────────────────────────────────────────────────────────────────────┘
```

- Red dot (●) on left for each error row
- First line: root span name (the trace), service (if set, blank otherwise), duration, cost, model
- Second line: erroring span name (if different from root; "(root)" if root errored) + exception type + message, truncated to one line, monospace
- Clicking opens trace drawer with erroring span pre-selected

## Columns

### Default Column Set

### Table Scrolling

The table scrolls both horizontally and vertically. **Do not cram columns to fit the viewport.** Each column gets a sensible minimum width so content is readable. If the total column width exceeds the container, horizontal scrolling is expected and fine.

- The table container has `overflow-x: auto` and `overflow-y: auto`
- The Time column is sticky (frozen) at the left edge during horizontal scroll so the user always has context
- The table header row is sticky during vertical scroll

| Column | Content | Format | Min Width | Notes |
|---|---|---|---|---|
| Time | When the trace occurred | Relative ("2m ago"), absolute on hover | 80px | Sort: desc by default. Sticky left. |
| Trace | Root span name + I/O (see Row Format below) | See below | 300px | Adapts by trace type |
| Service | Service of root span | Full name, no truncation | 120px | Optional — blank if not set |
| Duration | Total trace duration | "1.2s", "340ms" | 80px | Inline proportional bar (subtle) |
| Cost | Total estimated cost | "$0.003", "$1.24" | 80px | Appropriate precision |
| Tokens | Total input + output | Compact: "1.2K", "450" | 80px | Combined, not split |
| Model | Primary model | `oai/4o`, `ant/sonnet` | 100px | Multiple: primary + "+2" badge |

### Status Indicator (left border, not a column)

Status is NOT a column. It's a 2px left border + subtle row background tint:

**Left border:**
- **OK:** No border (clean left edge)
- **Warning:** 2px `yellow.400` left border
- **Error:** 2px `red.400` left border

**Row background tint:**
- **OK:** No background (default)
- **Warning:** `yellow.50` background (light mode) / `yellow.900` at 10% opacity (dark mode)
- **Error:** `red.50` background (light mode) / `red.900` at 10% opacity (dark mode)

The tint is very subtle. Just enough to create a visual band across the row. Combined with the border, errors and warnings are scannable from any distance without needing a dedicated column.

Benefits:
- Saves ~40px of horizontal space (no Status column)
- Visible at a glance: left border for precision, background for ambient awareness
- Works like IDE gutter markers + line highlighting
- No column header needed, no sort (use `@status:error` filter instead)

For **grouped table headers** (PRD-019): border + background show the worst status in the group. Red if any errors, yellow if any warnings, nothing if all OK.

The background tint composes with hover state: hovering an error row shows both the hover highlight AND the red tint underneath. They layer, not replace.

### Row Format (two-zone rows)

Every row has a consistent **header line** with all metrics in columns. LLM traces get additional **I/O detail lines** below the header that span the full row width. This keeps the column grid clean while giving I/O the space it needs.

**LLM trace (has I/O):** Header line + full-width I/O sub-rows.
```
┌───────┬──────────────────────┬─────────┬──────┬──────┬──────┬────────┬──────┐
│ 2m    │ agent.run            │ finance │ 1.2s │$0.003│ 1.2K │oai/4o  │ ●    │
│ ┆     │ ↑ "What's the refund policy for orders over $500?"                  │
│ ┆     │ ↓ "For orders over $500, our refund policy allows a full..."        │
├───────┼──────────────────────┼─────────┼──────┼──────┼──────┼────────┼──────┤
│ 8m    │ rag.retrieve         │ research│ 4.1s │$0.008│ 3.4K │oai/4o  │ ●    │
│ ┆     │ ↑ "Summarize the Q3 revenue report..."                              │
│ ┆     │ ↓ "Q3 revenue was flat at $2.4M..."                                 │
└───────┴──────────────────────────────────────────────────────────────────────┘
```

**Non-LLM trace (no I/O):** Header line only.
```
┌───────┬──────────────────────┬─────────┬──────┬──────┬──────┬────────┬──────┐
│ 5m    │ tool.search_db       │ fraud   │ 0.3s │$0.000│ —    │ —      │ ●    │
├───────┼──────────────────────┼─────────┼──────┼──────┼──────┼────────┼──────┤
│ 12m   │ guardrail.pii_check  │ support │ 0.1s │$0.001│ 120  │oai/4o  │ ●    │
└───────┴──────────────────────┴─────────┴──────┴──────┴──────┴────────┴──────┘
```

**Layout rules:**
- **Header line:** All columns aligned in the grid. Every row has this, identical structure.
- **I/O detail lines:** Use `colspan` from the Trace column to the end of the row. The Time column shows a dotted connector `┆` linking the detail to its header. The I/O lines are slightly indented and use muted text to visually subordinate them.
- **Row height:** Header line ~32-44px (per density). I/O detail adds ~20px per line. Non-LLM rows are just the header line.

**I/O preview rendering (data-driven):** The preview inspects the data shape to determine the display. It does NOT rely on the span type label.
- If the I/O is a chat messages array (has `role` + `content`): show the last user message as ↑ with 👤, and the assistant response as ↓ with 🤖. If the last message has `tool_calls`, show `↓ 🔧 [function_name](args...)`.
- If the I/O is plain text: show `↑ "input text..."` and `↓ "output text..."` with no role icons.
- If the I/O is JSON (non-chat): show `↑ {key: value...}` truncated.
- If no I/O exists: single-line row (no sub-rows).

This is a preview only — the full content with all messages is in the drawer I/O accordion (PRD-005).

**Detection:** A trace is "LLM" if it has `ComputedInput` AND `ComputedOutput` in trace summaries, OR if the root span has `gen_ai.input.messages` / `gen_ai.output.messages` in attributes. Otherwise, header-line-only row.

**Truncation:** I/O snippets truncated to fill available width with "..." Full text visible on hover tooltip or in the drawer.

### Error Preset Row Format

The Errors preset (section above) uses the same two-zone approach:

```
┌───────┬──────────────────────┬─────────┬──────┬──────┬──────┬────────┬──────┐
│ 2m    │ agent.run            │ finance │ 1.2s │$0.003│ 1.2K │oai/4o  │ ●    │
│ ┆     │ ╰ ▸ llm.openai.chat — RateLimitError: Rate limit exceeded for...    │
├───────┼──────────────────────┼─────────┼──────┼──────┼──────┼────────┼──────┤
│ 8m    │ rag.retrieve         │ research│ 4.1s │$0.000│ —    │ —      │ ●    │
│ ┆     │ ╰ ▸ tool.search_docs — TimeoutError: Document search timed out...   │
└───────┴──────────────────────────────────────────────────────────────────────┘
```

Same two-zone layout: header line in the column grid, error detail as a full-width sub-row.

### Implementation Note

Use TanStack Table (@tanstack/react-table) for the table component. It handles column definitions, sorting, virtualization, and custom cell rendering cleanly. The two-zone row can be implemented as a custom row renderer that conditionally adds a sub-row with colspan.

### Column Visibility & Reorder

[Columns] button (in the toolbar strip) opens a dropdown with checkboxes to show/hide columns and drag handles to reorder them.

- **Drag-to-reorder:** Visible, non-pinned columns have a drag handle (≡). Drag to reorder. Time column is pinned left and cannot be reordered.
- **Column order state:** Maintained as an ordered array (`columnOrder: string[]`). Visibility = membership in the array; order = position in the array.
- **Visual:** Drop target shows a blue top-border indicator during drag.

The dropdown is organized into sections:

```
┌──────────────────────────────────────┐
│  Columns                         [×] │
│                                      │
│  STANDARD                            │
│  ☑ Time                              │
│  ☑ Trace (name + I/O)               │
│  ☑ Duration                          │
│  ☑ Cost                              │
│  ☑ Tokens                            │
│  ☑ Model                             │
│  ☑ Status                            │
│  ☐ Service                           │
│  ☐ TTFT                              │
│  ☐ User ID                           │
│  ☐ Conversation ID                   │
│  ☐ Origin                            │
│  ☐ Environment                       │
│  ☐ Tokens In (separate)              │
│  ☐ Tokens Out (separate)             │
│  ☐ Span count                        │
│  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  │
│  EVALUATIONS                         │
│  ☐ Evals (summary badges)           │
│  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  │
│  Individual eval columns:            │
│  ☐ Faithfulness                      │
│  ☐ Topic Adherence                   │
│  ☐ Toxicity                          │
│  ☐ Prompt Injection                  │
│  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  │
│  EVENTS                              │
│  ☐ Events (count + exception flag)   │
└──────────────────────────────────────┘
```

- **Standard columns** are fixed — every project has them
- **Evaluations section** is dynamic — auto-populated from eval types that exist in the project. "Evals (summary badges)" shows a single column with compact inline badges. Individual eval columns each get their own sortable column. When an eval has its own column, it's excluded from the summary badges.
- **Events column** shows event count + exception indicator

### Eval Column Display

**Individual eval column** (one column per eval type):
- Numeric scores: `● 8.2` (colored dot + score)
- Pass/fail: `● ✓` or `● ✗`
- No eval for this trace: `—`
- Dot color: green (pass / >7), yellow (4-7), red (fail / <4)
- Sortable — click column header to sort by score
- Click the score → popover with full detail (score, status, reasoning, **timestamp** of when the eval ran)

**Summary badges column** ("Evals"):
- Compact inline badges: `● Faith 8.2  ● Toxic ✓  +1`
- Max 2-3 badges visible per row (based on column width)
- `+N` overflow — hover tooltip lists all remaining evals
- Click any badge → popover with score, status, reasoning
- Badges excluded if that eval already has its own column

### Events Column Display

- Count + exception indicator: `3 ⚠` (3 events, has exception), `1` (1 event), `—` (none)
- `⚠` appears if any exception events exist in the trace
- Click → opens drawer with Events accordion expanded
- **Note:** User feedback (thumbs up/down, ratings, annotations) is an event, not an evaluation. Feedback events are included in the event count. A 👍 or 👎 icon appears after the count if feedback events exist: `3 👍` or `2 👎`

### Data Fetching

The table queries **only the fields needed for visible columns**. The backend receives which columns are enabled and returns only that data from the trace summary. This keeps table queries fast.

- Default columns (Time, Trace, Duration, Cost, Tokens, Model, Status) are always fetched
- Eval scores, event counts, and optional columns are fetched only when their column is enabled
- Hover-triggered data (eval reasoning, cost breakdown, token breakdown) is fetched on demand — not included in the initial table query
- Column visibility preferences are persisted per user (localStorage), so the backend knows what to query on page load

## Row Behavior

- **Click:** Opens trace drawer. If the clicked trace is already open in the drawer, the drawer closes (toggle behavior). If a different trace is open, the drawer updates to show the clicked trace.
- **Selected state:** Left border accent + subtle background tint
- **Error rows:** Subtle red left border. Error rows still show the standard hover background change — the red border and hover state compose (both visible simultaneously).
- **Hover:** Subtle background change on all rows, including error rows. For two-zone rows (header + I/O sub-row), the hover must treat BOTH lines as one unit — hovering either line highlights both. They are visually one row.
- **Keyboard:** Up/Down navigate rows. Enter opens drawer.

## Presence Avatars (future)

Not built in Phase 1. No reserved layout space — add it when the feature is real.

## Density Toggle

- Segmented control in top-right: compact / comfortable
- **Compact:** ~32px row height, 12px font, tight padding
- **Comfortable:** ~44px row height, 14px font, generous padding
- Persisted as user preference (localStorage)

## Pagination

- 50 traces per page
- Bottom-right: previous/next arrows + current page indicator
- "Page 1 of 12 (583 traces)"
- NOT infinite scroll — explicit pagination

## Real-Time Updates (New Traces)

**Mechanism:** The Observe page polls for new traces every 30 seconds when on page 1 with no user scroll activity. This is NOT a WebSocket connection (that's Live Tail, PRD-015). Polling is lighter-weight and appropriate for the Observe page's calmer browsing context. The poll checks for traces newer than the most recent visible trace's timestamp.

When new traces arrive while the user is viewing the Observe page:

```
┌──────────────────────────────────────────────────────────┐
│  ┌────────────────────────────────────────────────────┐  │
│  │  ↑ 5 new traces                          [Show]   │  │
│  └────────────────────────────────────────────────────┘  │
│  Time  Name          Service    Dur   Cost  ...         │
│  2m    agent.run     finance    1.2s  $0.003  ...       │
│  ...                                                     │
└──────────────────────────────────────────────────────────┘
```

- **Don't jump the table.** New traces that match the current filters queue up silently.
- A banner appears above the first table row: "↑ N new traces" with a [Show] button.
- Clicking [Show] smoothly slides the new traces into the top of the table.
- If the user is on page 1 with no filters and their mouse/focus is NOT on the table, new traces can auto-insert (no button needed). When mouse returns to the table, stop auto-inserting and show the banner for any queued traces.
- If the user is on page 2+, or has active filters, new traces never auto-insert. Banner only.
- The count in the banner updates in real-time as more traces arrive.
- Banner dismisses automatically when traces are shown.

## Loading States

- **Initial load:** Skeleton rows (shimmer), ~10 rows
- **Preset switch:** Table visible with opacity reduction while re-querying
- **Empty after filter:** "No traces match the current filters" with clear filters link

## Data Gating

- Trace count = 0 for project → show onboarding empty state (PRD-001)
- Lens preset has no data (e.g., no errors) → inline empty state within table area
- Null/unavailable column values → "—" dash
- Estimated cost (`TokensEstimated = true`) → "~" prefix with tooltip "Estimated"
