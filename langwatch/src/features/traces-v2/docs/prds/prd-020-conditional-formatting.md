# PRD-020: Conditional Formatting

Parent: [Design: Trace v2](../design/trace-v2.md)
Phase: 2 (Lens Engine)
Status: DRAFT
Date: 2026-04-23

## What This Is

Color-code table cells based on value thresholds. Duration > 5s = red background. Cost > $0.10 = yellow. Users scan the table for problems instead of reading every number. Rules are per-lens (each lens has its own formatting). Only numeric columns support conditional formatting.

No competitor offers this on trace tables. It turns grouped lenses from "a list of numbers I have to read" into "I can see the problems at a glance."

## Supported Columns

Only numeric columns support conditional formatting:

| Column | Unit | Example thresholds |
|--------|------|--------------------|
| Duration | seconds | >5s = red, >2s = yellow, <1s = green |
| Cost | dollars | >$0.10 = red, >$0.01 = yellow |
| Tokens | count | >10K = red, >5K = yellow |
| Tokens In | count | >5K = red |
| Tokens Out | count | >5K = red |
| TTFT | seconds | >2s = red, >1s = yellow |

Non-numeric columns (Time, Trace, Service, Model, Status) do not support conditional formatting. Eval score columns (numeric) support it too.

## Rule Schema

```typescript
type ConditionalFormatRule =
  | { columnId: string; operator: '>' | '<'; value: number; color: 'red' | 'yellow' | 'green' }
  | { columnId: string; operator: 'between'; value: number; valueTo: number; color: 'red' | 'yellow' | 'green' };
// 'between' is inclusive on both boundaries: value <= x <= valueTo
```

- **3 colors:** red (problem), yellow (warning), green (good). Mapped to semantic tokens for dark/light mode.
- **3 operators:** `>` (greater than), `<` (less than), `between` (inclusive range).
- **Multiple rules per column:** A column can have up to 3 rules (one per color). If multiple rules match a value, the FIRST matching rule wins (ordered: red, yellow, green).
- **Per-lens:** Rules are stored in the lens's LensConfig. Different lenses can have different rules for the same column.

## Visual Rendering

### Cell Background

Matching cells get a subtle colored background tint:

```
Normal cell:        │ 1.2s │
Red (> 5s):         │ 6.3s │  ← subtle red-50 background
Yellow (> 2s):      │ 3.1s │  ← subtle yellow-50 background
Green (< 1s):       │ 0.4s │  ← subtle green-50 background
No rule / no match: │ 1.8s │  ← no background (default)
```

- Background: `red.50` / `yellow.50` / `green.50` in light mode; `red.900/0.3` / `yellow.900/0.3` / `green.900/0.3` in dark mode (Chakra semantic tokens with low opacity so text stays readable)
- Text color unchanged (the background is the signal, not the text)
- The tint is subtle. Not a screaming highlight. Just enough to create a visual pattern when scanning the table.

### Group Header Stats

When grouping is active (PRD-019), the group header's aggregate stats also get conditional formatting if rules exist for that column:

```
▶ gpt-4o        45 traces   avg 1.2s   $0.34 total
▶ llama-70b      8 traces   avg 6.3s   $0.00 total
                                  ↑ red background (avg > 5s)
```

This makes it possible to scan group headers and immediately see which groups have problems.

### Column Header Indicator

When a column has conditional formatting rules, its header shows a small colored indicator:

```
│ Duration 🔴🟡 │ Cost 🔴 │ Tokens │
```

- Shows colored dots for each active rule color (max 3: red, yellow, green)
- Dots are 6px circles next to the column name
- Columns without rules show no dots

## Creating Rules

### Entry Point

Right-click a numeric column header, or click the column header overflow menu (`⋯`):

```
┌────────────────────────┐
│ Sort ascending         │
│ Sort descending        │
│ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  │
│ Format column...       │  ← opens formatting popover
│ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  │
│ Hide column            │
└────────────────────────┘
```

Non-numeric columns don't show "Format column..." in their menu.

### Formatting Popover

```
┌──────────────────────────────────────┐
│  Format: Duration                    │
│                                      │
│  🔴 Red when    [> ▾] [5    ] s     │
│  🟡 Yellow when [> ▾] [2    ] s     │
│  🟢 Green when  [< ▾] [1    ] s     │
│                                      │
│  [+ Add rule]                        │
│                                      │
│  [Clear all]            [Apply]      │
└──────────────────────────────────────┘
```

- **Color selector:** Fixed order: red first, then yellow, then green. User picks which thresholds map to which color.
- **Operator dropdown:** `>`, `<`, `between`. When "between" is selected, a second value input appears.
- **Value input:** Numeric input. Unit label next to it matches the column (s for duration, $ for cost, nothing for tokens).
- **[+ Add rule]:** Adds another rule row (up to 3 total, one per color). Once all 3 colors are used, the button disappears.
- **[Clear all]:** Removes all rules for this column. Closes popover.
- **[Apply]:** Saves rules to the lens's LensConfig. Lens enters draft state (PRD-017). Popover closes.
- **Escape:** Closes popover without saving.

### Pre-populated Defaults

When opening "Format column..." on a column with no existing rules, suggest defaults based on the column type:

| Column | Suggested defaults |
|--------|--------------------|
| Duration | Red > 5s, Yellow > 2s, Green < 1s |
| Cost | Red > $0.10, Yellow > $0.01 |
| Tokens | Red > 10000, Yellow > 5000 |
| TTFT | Red > 2s, Yellow > 1s |

Defaults are pre-filled but not applied. The user sees them in the popover and can adjust before clicking Apply. If the user opens the popover and clicks Apply without changes, the defaults are used.

## Removing Rules

- **Via popover:** Click the `×` next to a rule row. Or "Clear all" to remove all rules.
- **Via column header:** Right-click the column header, "Clear formatting."
- **Per-lens:** Removing rules on one lens doesn't affect other lenses.

## Interaction with Lenses

- **Draft state:** Adding, editing, or removing rules puts the lens into draft state (dot indicator).
- **Save:** Rules are saved as part of the LensConfig's `conditionalFormatting` array.
- **Built-in lenses:** Can add formatting (lens enters draft state). Must "Save as new lens" to keep it.
- **New lens creation:** Current formatting rules are captured in the new lens.

## Interaction with Grouping

- Conditional formatting applies to both individual trace rows AND group header aggregate stats.
- In group headers: the aggregate value (e.g., avg duration) is evaluated against the rules.
- This is the power combination: grouped by model + duration formatting = instant visibility into which models are slow.

## Data Gating

- **Null/missing values:** Cells with `—` (no data) do not match any rule. No background color.
- **Estimated values:** Cells with `~` prefix (estimated cost) are evaluated against rules using the estimated value. The `~` prefix remains visible.
- **Column hidden:** If a column with formatting rules is hidden (toggled off), the rules are preserved in the LensConfig but not evaluated. Re-showing the column restores the formatting.
- **0 value:** Evaluated normally against rules. `cost = $0.00` matches `< $0.01` rule if one exists.

## Performance

- Conditional formatting is evaluated client-side only. No server queries.
- Rules are evaluated per-cell during render. With 50 rows and 3 formatted columns, that's 150 evaluations per render. Negligible.
- For group headers: aggregate stats arrive from the server (PRD-019). Formatting is applied to the aggregate value client-side.

## Keyboard / Accessibility

- **Tab to formatted cell:** Screen reader announces the value and the formatting status: "Duration: 6.3 seconds, formatted as red (above threshold)."
- **Column header dots:** Screen reader announces "Duration column, has conditional formatting rules."
