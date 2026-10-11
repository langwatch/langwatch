# ADR-003: Content tabs read the product's accent from one file

**Date:** 2026-10-11

**Status:** Accepted (ruling by Alex, 2026-10-11)

**Behavioural contract:**
[Product colours](../specs/product-colours.feature) and [Content tabs](../specs/content-tabs.feature)

**Related:** [ADR-001](./001-design-system-boundary.md), [ADR-002](./002-overlay-and-card-shapes.md).
Table parts are decided by their own ADR when they land; this one covers tabs and colour.

## Context

Content tabs drew one fixed accent. Alex ruled: "One accent per product, set up by us, in ONE
design-system file (product name -> colour token), so a tweak or removal is one edit. Tabs and
other accent uses read the product's colour from it." The same ruling keeps the look: polish,
not a rebrand. Three of the four products already draw the accent orange; only Me draws blue.

## Decision

1. **One assignment.** `src/system/product-colours.ts` maps each product to an existing
   semantic palette (`PRODUCT_COLOURS`). Me is blue; LLM Ops, Gateway and Governance keep the
   current accent. Nothing else spells this mapping.
2. **Aliases, not colours.** `config.ts` registers `product.<id>.<role>` tokens generated from
   the map. Each of the ten roles aliases the same role of the assigned palette, so no new value
   exists and global accent, orange, blue, status and chart tokens are untouched.
3. **Removal is one edit.** A product set to null keeps its identity and its roles resolve to
   gray. Consumers never branch on a product.
4. **A scope and a hook.** `ProductScope` declares the product of a subtree and draws nothing;
   `useProductAccent` returns the resolved palette, the `colorPalette` value and the role token
   names. Absence of a scope is the unscoped accent, never the last product visited. React
   context crosses portals, so drawers and menus keep their product; no root-wide
   `colorPalette` is set.
5. **Tabs read it.** The tab machine under ContentTabs, CodeTabs and MetricTabs takes
   `colorPalette` from the hook. Geometry, mount policy, keyboard controls and code glass are
   unchanged. Navigation owns declaring the scope for routed pages; it proves its registry has
   the same keys as `ProductName`.
6. **A 16px side inset** (DS-cap1). `inset` is `none | sm | md`: 0, 16px (`sm`) and 24px
   (`md`) on the list and the panel sides, with the strip's rule still full width. The default
   stays `none`; only the new `sm` step is added, for a drawer pane that aligns with 16px blocks.
7. **A counted tab is named with a space.** `TabCount` puts a visually hidden space before the
   figure, so the tab's accessible name reads "People 5", "People 0", or just "People" while
   the count is unknown. The badge itself, its size and its zero behaviour are unchanged.

## Consequences

- Tabs inside Me draw blue (the section's existing identity); every other product, and every
  surface outside a product, draws exactly what it drew before.
- Feature lanes replace product-colour literals with the hook's result; they add no map.
- Brand, status, chart and vendor colours never read this map.

## Amendment DS3 (2026-10-11): widths, tall headers, padding rows

`ListTable.Column` `width` is optional (omitted, no width is declared). `headerLayout="content"` lets header
cells grow with wrapped content (auto height, top aligned, 10px inset). `ListTable.PaddingRow` already takes
`{ columns, height }`; the census no longer reads that `height` as a restyle. `LoadMore` takes `label`,
`aria-label` and `appearance="compact"`. `SelectionActionBar` Clear restores select-all focus on the next
animation frame, after the header has been rebuilt.
