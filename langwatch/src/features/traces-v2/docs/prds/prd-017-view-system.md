# PRD-017: Lens System

Parent: [Design: Trace v2](../design/trace-v2.md)
Phase: 2 (Lens Engine)
Status: DRAFT
Date: 2026-04-23

## What This Is

The lens system that lets users create, save, edit, and manage custom table configurations. A "lens" is a named configuration of columns, grouping, sort, filters, and conditional formatting rules. Each lens is a different way of looking at the same trace data. Phase 1 ships 3 built-in lenses (All Traces, Conversations, Errors). Phase 2 adds 3 more built-in lenses and lets users create their own.

This is the core feature of Phase 2. PRDs 018-021 extend this system with column configuration, grouping, conditional formatting, and analytics.

## Terminology

- **Lens**: a named configuration that controls how the table displays data. User-facing and internal term are the same.
- **Built-in lens**: shipped with the product, can't be overwritten or deleted
- **Custom lens**: created by the user, fully editable
- **LensConfig**: the TypeScript interface that defines a lens (internal/code only)

## LensConfig Schema

The data model that every lens feature reads and writes:

```typescript
interface LensConfig {
  id: string;                          // uuid for custom lenses, slug for built-ins
  name: string;                        // user-visible tab label
  isBuiltIn: boolean;                  // true = shipped with product
  columns: ColumnConfig[];             // ordered list of visible columns
  grouping: 'flat' | 'by-session' | 'by-service' | 'by-user' | 'by-model';
  sort: { columnId: string; direction: 'asc' | 'desc' };
  filters: FilterClause[];            // default filters (e.g., Errors lens has @status:error)
  conditionalFormatting: ConditionalFormatRule[];
  lockedGrouping?: boolean;            // true on built-in grouped lenses, locks the grouping selector
  createdAt: string;                   // ISO 8601
  modifiedAt: string;
}

interface FilterClause {
  field: string;                       // e.g., 'status', 'model', 'service'
  value: string;                       // e.g., 'error', 'gpt-4o'
}

interface ColumnConfig {
  columnId: string;                    // e.g., 'time', 'trace', 'duration', 'cost'
  width: number;                       // px, user-adjustable via drag
  pinned?: 'left' | 'right';          // Time pinned left, Status pinned right
}

type ConditionalFormatRule =
  | { columnId: string; operator: '>' | '<'; value: number; color: 'red' | 'yellow' | 'green' }
  | { columnId: string; operator: 'between'; value: number; valueTo: number; color: 'red' | 'yellow' | 'green' };
// 'between' is inclusive on both boundaries
```

See PRD-020 for conditional formatting details, PRD-018 for column configuration details.

## Lens Tabs UI

Lenses appear as tabs in the toolbar area, above the table:

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ 🔍 @status:error AND @model:gpt-4o                    [Last 24h ▾] [Clear] │
├────────────┬─────────────────────────────────────────────────────────────────┤
│  FILTERS   │ [All Traces] [Conversations] [Errors] [By Model] [My Lens •]  │
│            │                                          [Group: flat ▾] [+]   │
│            │ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  │
│            │  (table content)                                               │
```

### Tab Layout

- **Tab bar position:** Below the search bar, above the table. Same row as the grouping selector and density toggle.
- **Tab order:** Built-in lenses first (fixed order), then custom lenses in creation order.
- **Active tab:** Solid underline + bold text. Inactive tabs: muted text, no underline.
- **[+] button:** At the far right of the tab bar. Opens the "Save as lens" popover (see below).
- **Overflow:** If tabs exceed the available width, a horizontal scroll appears on the tab bar. No wrapping. A subtle gradient fade on the right edge hints at more tabs.

### Built-in Lenses

Phase 2 ships 6 built-in lenses:

| Lens | Grouping | Default Filters | Locked Facets | Notes |
|------|----------|----------------|---------------|-------|
| All Traces | flat | none | none | Default lens. Same as Phase 1. |
| Conversations | by-session | traces with conversation ID only | Conversation-related | Same as Phase 1 (PRD-002). Refactored to use grouping engine (PRD-019). |
| Errors | flat | @status:error | Status facet | Same as Phase 1 (PRD-002). |
| By Model | by-model | none | none | **New.** Groups by primary model. |
| By Service | by-service | none | none | **New.** Groups by service name. |
| By User | by-user | none | none | **New.** Groups by user ID. Shows only traces with user ID. |

Built-in lenses:
- Cannot be renamed, deleted, or overwritten
- Show the standard column set by default (user can toggle columns, but changes are draft state)
- Grouped built-in lenses (Conversations, By Model, By Service, By User) lock the grouping selector to their dimension (see PRD-019)

## Creating a Lens

### "Save as Lens" Flow

Two entry points:
1. **[+] button** in the tab bar (saves the current table state as a new lens)
2. **"Save as new..." option** from the draft state dropdown on any lens tab

Both open the same popover:

```
┌──────────────────────────────────┐
│  Save as lens                    │
│                                  │
│  Name: [My custom lens      ]   │
│                                  │
│  [Cancel]           [Save lens]  │
└──────────────────────────────────┘
```

- **Popover position:** Anchored below the [+] button or the tab that triggered it
- **Name input:** Auto-focused. Pre-filled with "Custom lens" (or "Custom lens (2)" etc. if that name exists)
- **Duplicate names:** Allowed. No uniqueness constraint. Users may want "Errors" and a custom "Errors" (unlikely but not worth preventing).
- **Empty name:** Disabled Save button. Inline hint: "Name is required."
- **Enter key:** Submits (saves the lens)
- **Escape key:** Cancels (closes popover)

### What Gets Saved

The new lens captures the CURRENT table state:
- Which columns are visible and their order
- Column widths
- Grouping mode
- Sort column and direction
- Active filters from the search bar / facets (serialized as FilterClause[])
- Conditional formatting rules (if any are active)

### After Saving

- New tab appears immediately to the right of the last tab
- The new tab becomes active
- No dot indicator (it's a fresh save, nothing modified)

## Draft State

Draft state applies to **all lenses** — both custom and built-in. Any lens shows the draft dot when its current configuration differs from its saved (or factory) state.

### Why All Lenses Show Draft State

The dot serves a different purpose for each lens type:
- **Custom lenses:** The dot means "you have unsaved changes — save, save as new, or revert."
- **Built-in lenses:** The dot means "you've customized this — save as a new lens to keep it, or reset to defaults." Built-in lenses can never be overwritten, so the dot nudges users toward creating a custom lens rather than losing their configuration when they navigate away.

Without the dot on built-in lenses, users customize columns/filters/grouping, switch tabs, and lose everything with no indication that anything was at risk. The dot is the ambient signal that says "this is worth saving."

### What Triggers Draft State

The dot appears when **any** of the following differ from the lens's saved (or factory-default) config:

| Change | Tracked in |
|--------|-----------|
| Column visibility or order | viewStore (`columnOrder`, `hiddenColumns`) |
| Grouping mode | viewStore (`grouping`) |
| Sort column or direction | viewStore (`sort`) |
| Filter query (sidebar facets, search bar, range sliders) | filterStore (`queryText`) vs lens's saved filters |
| Conditional formatting rules | viewStore (future, PRD-020) |

The dot disappears when the lens returns to its saved state — via Save, Revert, or Reset to defaults.

### Visual Indicator

When any lens has unsaved changes, the tab shows a dot: `All Traces •` or `My Lens •`

```
Tab states:
┌──────────────────┐  ┌──────────────┐  ┌──────────────┐
│ All Traces •     │  │ My Lens •    │  │ Errors       │
│  (modified,      │  │  (modified,  │  │  (unchanged, │
│   built-in)      │  │   custom)    │  │   built-in)  │
└──────────────────┘  └──────────────┘  └──────────────┘
```

- The `•` is a small filled circle (blue) next to the lens name
- **The dot is purely visual. It is not clickable.** It does not open a dropdown or trigger any action.

### Draft Actions (context menu, not dot click)

Draft actions live in the tab's context menu. Access via right-click on the tab or the `⋯` overflow button that appears on hover.

**Custom lens context menu:**

```
Right-click custom lens tab (or click ⋯):
┌────────────────────┐
│ Save               │  ← overwrites current lens config
│ Save as new lens...│  ← opens Save as popover, original untouched
│ ─ ─ ─ ─ ─ ─ ─ ─ ─ │
│ Revert changes     │  ← snaps back to saved state
│ ─ ─ ─ ─ ─ ─ ─ ─ ─ │
│ Rename...          │
│ Duplicate          │
│ ─ ─ ─ ─ ─ ─ ─ ─ ─ │
│ Delete             │
└────────────────────┘
```

- **Save:** Overwrites the lens's LensConfig. Dot disappears.
- **Save as new lens...:** Opens the Save as popover. Creates a new lens. Original unchanged.
- **Revert changes:** Resets table to the lens's saved config. Dot disappears.
- Save and Revert are greyed out when there are no unsaved changes (no dot).

**Built-in lens context menu:**

```
Right-click built-in lens tab (or click ⋯):
┌────────────────────┐
│ Save as new lens...│  ← opens Save as popover, built-in untouched
│ ─ ─ ─ ─ ─ ─ ─ ─ ─ │
│ Reset to defaults  │  ← clears any changes, back to factory config
│ ─ ─ ─ ─ ─ ─ ─ ─ ─ │
│ Duplicate          │
└────────────────────┘
```

No Save, no Rename, no Delete. Built-in lenses can't be modified — only forked.
- **Save as new lens...:** Always available. Pre-fills the name with the built-in lens name (e.g., "All Traces"). If there's no draft state, saves a copy of the factory config.
- **Reset to defaults:** Greyed out when there are no unsaved changes (no dot). Clears draft state and restores factory config.

### Navigate Away = Silent Discard

When the user clicks a different lens tab while any lens has unsaved changes:
- Changes are silently discarded
- The lens reverts to its saved/factory state
- No confirmation dialog
- The dot was the warning — if the user didn't act on it, the changes are ephemeral

This applies equally to custom and built-in lenses.

## Editing a Custom Lens

### Rename

Right-click a custom lens tab (or click a `⋯` overflow menu on hover):

```
┌────────────────────┐
│ Rename...          │
│ Duplicate          │
│ ─ ─ ─ ─ ─ ─ ─ ─ ─ │
│ Delete             │
└────────────────────┘
```

- **Rename:** Tab text becomes an editable inline input. Enter confirms, Escape cancels.
- **Duplicate:** Creates a copy with name "{original name} (copy)". New tab added to the right.
- **Delete:** Removes the lens. If this was the active tab, switch to All Traces.

### Delete Confirmation

Deleting a lens shows a brief confirmation:

```
┌──────────────────────────────────┐
│  Delete "My Lens"?               │
│  This cannot be undone.          │
│                                  │
│  [Cancel]              [Delete]  │
└──────────────────────────────────┘
```

This is the ONE confirmation dialog in the lens system. Unlike navigate-away (silent discard, reversible by just recreating the lens), deletion is destructive and irreversible.

## Persistence

- **Storage:** localStorage under key `langwatch:lenses:{projectId}`
- **Format:** JSON array of LensConfig objects
- **Built-in lenses are NOT stored.** They're defined in code. Only custom lenses are persisted.
- **Column visibility/width overrides on built-in lenses** are stored separately: `langwatch:lensOverrides:{projectId}` as a map of `{ [lensId]: Partial<LensConfig> }`. Revert clears the override.

### Known Limitations (Phase 2)

- Clearing browser data deletes all custom lenses
- Lenses don't sync across devices or browsers
- ~5MB localStorage limit (shared with all app storage)
- The "Save as lens" popover should set expectations: "Saved to this browser"
- The localStorage format is designed for easy migration to server-side persistence in Phase 3B

## Data Gating

- **No custom lenses exist:** Only built-in tabs shown. [+] button visible.
- **Many custom lenses (10+):** Tab bar scrolls horizontally. Consider adding a "Lenses" dropdown at the right end that lists all lenses if this becomes common.
- **Corrupted localStorage:** If lens data can't be parsed, silently reset to built-in lenses only. Log a warning to console.
- **Storage quota exceeded:** If localStorage.setItem throws a QuotaExceededError, show a non-blocking toast: "Could not save lens. Browser storage full." The lens remains in memory until the page is refreshed. Log a warning to console.
- **Lens references a deleted column:** Column is silently removed from the lens's config. Lens renders with remaining columns.

## Keyboard

- **Cmd/Ctrl + number (1-9):** Switch to lens by position. Cmd+1 = first tab, etc.
- **Right-click tab:** Opens context menu (Rename, Duplicate, Delete for custom; no menu for built-in)
