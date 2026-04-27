# PRD-011: Accessibility & Responsive Behavior

Parent: [Design: Trace v2](../design/trace-v2.md)
Status: DRAFT
Date: 2026-04-22

## What This Is

Cross-cutting accessibility and responsive requirements that apply to all Phase 1 PRDs. Not a separate feature, but specs that must be met across the entire UI.

## Keyboard Navigation

### Focus Zone Model

Keyboard shortcuts are scoped to **focus zones**. A shortcut only fires within the zone that currently has focus. This resolves conflicts where the same key (e.g., Up/Down, Enter, Escape) means different things in different parts of the UI.

```
┌─ PAGE (always active) ──────────────────────────────────────┐
│  / → focus search bar                                       │
│  Escape → cascade (see Escape Cascade below)                │
│                                                             │
│  ┌─ SEARCH ──┐  ┌─ SIDEBAR ──┐  ┌─ TABLE ────────────────┐│
│  │ Enter=run  │  │ Space=check│  │ ↑↓=rows  Enter=open    ││
│  │ ↑↓=suggest │  │ Tab=facets │  │ Shift+Enter=peek       ││
│  │ Esc=unfocus│  │            │  │                         ││
│  └────────────┘  └────────────┘  └─────────────────────────┘│
│                                                             │
│  ┌─ DRAWER ─────────────────────────────────────────────────┐
│  │  T=toggle mode   O=Trace Summary tab   Esc=cascade      │
│  │                                                          │
│  │  ┌─ VIZ ZONE ──────────────────────────────────────────┐│
│  │  │  1/2/3=switch view                                   ││
│  │  │                                                      ││
│  │  │  [SPAN TREE]     [FLAME GRAPH]     [SPAN LIST]      ││
│  │  │  ↑↓=spans        ↑↓=depth          ↑↓=rows          ││
│  │  │  ←→=collapse/exp  ←→=siblings       Enter=select    ││
│  │  │  Enter=select     Enter=zoom                         ││
│  │  │  Home/End=jump    Space=select                       ││
│  │  │                   Backspace=zoom out                  ││
│  │  │                   Esc=zoom out                        ││
│  │  └──────────────────────────────────────────────────────┘│
│  │                                                          │
│  │  ┌─ TAB BAR ───┐  ┌─ ACCORDIONS ──────────────────────┐│
│  │  │ ←→=switch    │  │ Enter=toggle  ↑↓=between sections ││
│  │  └──────────────┘  └──────────────────────────────────┘ │
│  └──────────────────────────────────────────────────────────┘
└─────────────────────────────────────────────────────────────┘
```

**Rules:**
1. **Each zone owns its shortcuts.** Up/Down navigates rows in the TABLE zone, spans in the SPAN TREE zone, and blocks in the FLAME GRAPH zone. They never conflict because only one zone has focus at a time.
2. **Focus transfers on interaction.** Clicking inside a zone gives that zone focus. Opening the drawer focuses the drawer. Clicking the waterfall focuses the VIZ ZONE.
3. **Tab cycles between zones within the drawer:** VIZ ZONE → TAB BAR → ACCORDIONS → VIZ ZONE. Shift+Tab reverses.
4. **Global shortcuts (/ and Escape) work regardless of focus zone.** / always focuses the search bar. Escape always follows the cascade.

### Escape Cascade

Escape always means "exit the current context, one level at a time." The cascade is strictly ordered:

1. **Flame graph zoomed?** → Zoom out one level
2. **Span tab open?** → Close span tab, return to Trace Summary
3. **Drawer open?** → Close drawer, focus returns to table row
4. **Search focused?** → Unfocus search bar
5. **Nothing active** → No-op

Each press of Escape moves exactly one step down this list. A user pressing Escape repeatedly will unwind all nested state in predictable order.

### Zone: Page (Global)

| Key | Action |
|---|---|
| `/` | Focus search bar (from anywhere) |
| `Escape` | Cascade (see above) |

### Zone: Search Bar

| Key | Action |
|---|---|
| `Enter` | Execute query |
| `Escape` | Unfocus, return focus to table |
| `Up/Down` | Navigate autocomplete suggestions |
| `Tab` | Accept autocomplete suggestion |

### Zone: Filter Sidebar

| Key | Action |
|---|---|
| `Space` | Toggle focused checkbox |
| `Tab` | Move to next facet section |
| `Shift+Tab` | Move to previous facet section |

### Zone: Table

| Key | Action |
|---|---|
| `Up/Down` | Navigate between trace rows |
| `Enter` | Open drawer for focused row |
| `Shift+Enter` | Open trace peek for focused row |

### Zone: Drawer (chrome)

These shortcuts work anywhere in the drawer, regardless of which sub-zone has focus:

| Key | Action |
|---|---|
| `T` | Toggle Trace/Conversation mode (when conversation exists) |
| `O` | Switch to Trace Summary tab (when span tab is open) |
| `Escape` | Cascade (see above) |

### Zone: Viz — Span Tree (Waterfall)

Active when the span tree in the waterfall view has focus.

| Key | Action |
|---|---|
| `Up/Down` | Navigate between spans (previous/next visible) |
| `Left` | Collapse current span, or move to parent |
| `Right` | Expand current span, or move to first child |
| `Enter` | Select span → open span tab |
| `Home/End` | Jump to first/last span |

### Zone: Viz — Flame Graph

Active when the flame graph has focus.

| Key | Action |
|---|---|
| `Enter` | Zoom into focused block |
| `Space` | Select focused block → open span tab (without zooming) |
| `Backspace` | Zoom out one level |
| `Escape` | Zoom out one level (if zoomed; otherwise cascade continues) |
| `Up` | Move to parent block |
| `Down` | Move to first child block |
| `Left/Right` | Navigate between sibling blocks |

### Zone: Viz — Span List

Active when the span list table has focus.

| Key | Action |
|---|---|
| `Up/Down` | Navigate between span rows |
| `Enter` | Select span → open span tab |

### Zone: Tab Bar

| Key | Action |
|---|---|
| `Left/Right` | Switch between Trace Summary and Span tabs |

### Zone: Accordions

| Key | Action |
|---|---|
| `Up/Down` | Navigate between accordion sections |
| `Enter` | Toggle accordion open/close |

### Missing Shortcuts (not yet assigned)

These are navigation shortcuts that would improve the experience but are not yet assigned:

| Need | Suggested Key | Notes |
|---|---|---|
| Navigate to prev/next trace (while in drawer) | `J/K` | Vim-style. Avoids conflict with Up/Down which are zone-scoped to spans/blocks. |
| Navigate prev/next conversation turn | `[` / `]` | Context peek arrows. Avoids Left/Right conflict with tree collapse. |
| Toggle filter sidebar | `F` | Quick access to show/hide filters. |
| Toggle drawer maximize | `M` | Expand drawer to full width. |
| Copy trace/span ID | `C` | Quick copy of the focused element's ID. |

## Focus Management

- **Drawer opens:** Focus moves to the drawer header. Announced as "Trace detail panel opened."
- **Drawer closes:** Focus returns to the trace row that was selected in the table.
- **Span tab opened:** Focus moves to the span tab label in the tab bar.
- **Trace/Conversation toggle:** Focus stays on the toggle after switching.
- **Tab/accordion switch:** Focus stays on the tab/accordion button after switching.
- **Click inside viz:** Focus moves to the active visualization zone (span tree, flame graph, or span list).
- **Tab within drawer:** Cycles VIZ ZONE → TAB BAR → ACCORDIONS. Shift+Tab reverses.
- Focus trapping: drawer does NOT trap focus (user can Tab back to the table). It's a panel, not a modal. Exception: below 1024px width, the drawer is full-screen and DOES trap focus (it's effectively a modal).

## ARIA

### Landmarks

| Region | ARIA Role | Label |
|---|---|---|
| Filter sidebar | `complementary` | "Trace filters" |
| Trace table | `main` | "Trace list" |
| Drawer | `complementary` | "Trace detail" |
| Search bar | `search` | "Filter traces" |

### Labels

| Element | ARIA Attribute | Example |
|---|---|---|
| Status dot | `aria-label` | "Status: Error" |
| Span type icon | `aria-label` | "Type: LLM" |
| Timing bar | `aria-label` | "Duration: 1.2 seconds, 52% of trace" |
| Accordion section | `aria-expanded` | true/false |
| Selected trace row | `aria-selected` | true |
| Origin facet checkboxes | `role="group"` | with `aria-label="Filter by origin"` |
| Preset tabs | Built-in from Chakra Tabs | |
| Density toggle | `aria-label` | "Display density" |

### Live Regions

- **Filter applied:** `aria-live="polite"` region announces "Showing N traces" after filter change
- **Drawer content loaded:** Announced when streaming data completes
- **Error states:** `role="alert"` for error messages

## Keyboard Shortcut Hints

Every interactive element that has a keyboard shortcut displays the key as a visible hint badge. Small, muted, right-aligned or inline — never hidden behind a tooltip.

```
┌───────────────────────────────────────────┐
│  [Waterfall ₁] [Flame ₂] [Span List ₃]  │
│                                           │
│  [Trace  T]  [Conversation]              │
│                                           │
│  🔍 Filter traces...                  /  │
│                                           │
│  ▼ I/O                                   │
│  ▶ Events                                │
│  ▶ Evals                                 │
└───────────────────────────────────────────┘
```

| Element | Shortcut displayed | Style |
|---|---|---|
| Search bar | `/` shown at right edge of input | Muted `Kbd` badge |
| Viz tabs (Waterfall/Flame/Span List) | `1` `2` `3` next to each tab label | Muted `Kbd` badge |
| Trace/Conversation toggle | `T` next to Trace label | Muted `Kbd` badge |
| Trace Summary tab | `O` next to Trace Summary label (when span tab open) | Muted `Kbd` badge |
| Close drawer | `Esc` in the close button area | Muted `Kbd` badge |
| Prev/next trace | `J` `K` in drawer header area | Muted `Kbd` badge |
| Prev/next turn | `[` `]` in context peek area | Muted `Kbd` badge |

Use Chakra's `Kbd` component for consistent styling. Badges are always visible, not hover-only. Muted color so they don't compete with the primary label.

## Color Contrast

- All text meets WCAG 2.1 AA minimum (4.5:1 for body text, 3:1 for large text)
- Status dots are not color-only: they also have text labels in the drawer header ("OK", "Error")
- Span type colors in the tree are supplemented by type icons (not color-only differentiation)
- Interactive elements have visible focus rings (Chakra's default focus outline, not suppressed)

## Touch Targets

- Minimum 44px touch target for interactive elements on tablet viewports
- Trace table rows: comfortable density mode (~44px) meets this. Compact mode (~32px) is below minimum — acceptable for desktop-only usage, but tablet users should default to comfortable.

## Responsive Breakpoints (Chakra Container Queries)

Uses Chakra v3 container queries (`@container`) based on the Observe page content area width, not viewport width. This ensures the layout adapts correctly regardless of surrounding app chrome, sidebars, or panels.

| Container Width | Layout | Behavior |
|---|---|---|
| ≥1400px | Filter sidebar + Table + Drawer | Full three-column layout |
| 1200-1399px | Table + Drawer | Filter sidebar auto-collapses when drawer opens. Toggle to show filters hides drawer. |
| 1024-1199px | Table + Drawer (narrower) | Table shows fewer columns (Name, Duration, Status only). Filter sidebar collapsed by default. |
| <1024px | Single column | Drawer goes full-width when open. Table hidden. Back button returns to table. Filter sidebar is a slide-over overlay. |

### Column Priority (when table narrows)

Columns hide in this order as width decreases:
1. Tokens (hide first)
2. Model
3. Cost
4. Service
5. Duration
6. Name + Status (always visible)

### Drawer at Narrow Viewports

Below 1024px, the drawer becomes full-screen. The header shows a back arrow. The visualization section gets more vertical space since there's no side-by-side constraint.
