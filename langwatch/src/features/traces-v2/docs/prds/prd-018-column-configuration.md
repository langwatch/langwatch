# PRD-018: Column Configuration

Parent: [Design: Trace v2](../design/trace-v2.md)
Extends: [PRD-002: Trace Table](prd-002-trace-table.md)
Phase: 2 (Lens Engine)
Status: DRAFT
Date: 2026-04-23

## What This Is

User-configurable column layout: show/hide, drag-to-reorder, and resize. Extends PRD-002's column visibility dropdown with direct manipulation interactions. Column state is part of the LensConfig (PRD-017) and persists with the lens.

## Column Visibility

Same dropdown as PRD-002 (unchanged). The [Columns] button opens a dropdown with checkboxes organized by section (Standard, Evaluations, Events). Toggling a column immediately updates the table and puts the current lens into draft state (PRD-017).

## Column Drag-to-Reorder

Users can drag column headers to rearrange the column order.

### Interaction

```
Before drag:
│ Time │ Trace │ Duration │ Cost │ Tokens │ Model │ Status │

Dragging "Cost" to the left of "Duration":
│ Time │ Trace │ [Cost ▐] │ Duration │ Tokens │ Model │ Status │
                    ↑ ghost of dragged column
                 ↑ blue insertion line shows drop target

After drop:
│ Time │ Trace │ Cost │ Duration │ Tokens │ Model │ Status │
```

### Rules

- **Drag handle:** The entire column header cell is the drag handle. Cursor changes to `grab` on hover, `grabbing` during drag.
- **Visual feedback during drag:** The dragged column header shows as a semi-transparent ghost following the cursor. A blue vertical insertion line appears between columns to indicate the drop target.
- **Pinned columns excluded:** Time (pinned left) cannot be dragged. It doesn't show the grab cursor. Other columns cannot be dragged before Time.
- **Drop zone:** Only between non-pinned columns. Dropping on a pinned column snaps to the nearest valid position.
- **Draft state:** Reordering puts the lens into draft state (dot indicator on tab).
- **Persistence:** Column order is saved in the `columns` array of the LensConfig. The array order IS the display order.

### Accessibility

- **Keyboard reorder:** Select a column header with Enter, then use Left/Right arrows to move it. Enter confirms, Escape cancels.
- **Screen reader:** "Move [column name] column. Use left and right arrows to reposition."

## Column Resize

Users can drag column borders to adjust width.

### Interaction

```
Hover on column border (between "Duration" and "Cost"):
│ Duration ┃ Cost │
           ↑ cursor changes to col-resize

Drag to resize:
│ Duration    ┃ Cost │    (Duration wider, Cost same)
```

### Rules

- **Resize handle:** A 4px invisible hit area on the right border of each column header. Cursor: `col-resize`.
- **Minimum width:** Each column has a minimum width (defined in PRD-002's column table). The user cannot resize below this minimum.
- **Maximum width:** No maximum. Users can make a column as wide as they want.
- **Adjacent column behavior:** Resizing one column does NOT resize adjacent columns. The table width may exceed the container, triggering horizontal scroll (this is expected per PRD-002).
- **Double-click border:** Auto-fits the column to its content width (scans visible rows for the widest content, adds 16px padding).
- **Draft state:** Resizing puts the lens into draft state.
- **Persistence:** Column width is saved in the `width` field of each ColumnConfig.

### Pinned Column Resize

- Time (pinned left) and Status (pinned right) CAN be resized. Pinning prevents reorder, not resize.
- Resizing a pinned column adjusts the sticky offset accordingly.

## Column State in LensConfig

The `columns` array in LensConfig defines the complete column layout:

```typescript
// Example: user has reordered and resized
columns: [
  { columnId: 'time', width: 80, pinned: 'left' },
  { columnId: 'trace', width: 320 },
  { columnId: 'cost', width: 100 },      // moved before duration
  { columnId: 'duration', width: 80 },
  { columnId: 'tokens', width: 80 },
  { columnId: 'model', width: 120 },
  { columnId: 'status', width: 40, pinned: 'right' },
]
```

- Array order = display order (left to right)
- Columns not in the array are hidden
- Toggling a column ON adds it at the end (before Status if Status is last)
- Toggling a column OFF removes it from the array

## Default Column Set

When creating a new lens or resetting to defaults, the column set matches PRD-002's defaults:

| Column | Default Width | Pinned | Default Visible |
|--------|-------------|--------|-----------------|
| Time | 80px | left | yes |
| Trace | 300px | — | yes |
| Service | 120px | — | no |
| Duration | 80px | — | yes |
| Cost | 80px | — | yes |
| Tokens | 80px | — | yes |
| Model | 100px | — | yes |

Note: Status is not a column. It's a 2px left border on each row (see PRD-002). Not configurable via column settings.

Additional columns (TTFT, User ID, Conversation ID, Origin, Environment, etc.) are available via the column dropdown but hidden by default.

## Interaction with Lenses

- **Column changes on a built-in lens:** Lens enters draft state. User can "Save as new lens" to keep the customization or "Revert" to go back.
- **Column changes on a custom lens:** Lens enters draft state. User can "Save" to overwrite, "Save as new" to fork, or "Revert."
- **New lens creation via [+]:** Captures current column state (visibility, order, widths).

## Data Gating

- **Column references a field with no data:** Column renders with "—" in every row. Not hidden automatically (the user chose to show it).
- **Eval column for an eval type that doesn't exist in the project:** Column header renders but all rows show "—".
- **Column width below minimum after localStorage restore:** Clamp to minimum width. Don't error.

## Performance

- **Drag-to-reorder:** Uses HTML5 Drag and Drop API or a library like `@dnd-kit/core`. No layout recalculation during drag (only the ghost moves). Column positions update on drop.
- **Column resize:** Uses a `ResizeObserver` or pointer event handler. Table re-renders column widths via CSS `grid-template-columns` or explicit `width` styles. No full table re-render during drag (only the resizing column updates).
