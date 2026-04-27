# ADR-014: Depth-Aware Z-Index for Portalled Overlay Components

**Date:** 2026-03-26

**Status:** Accepted

## Context

LangWatch uses Chakra UI v3 (backed by Zag.js) for its component library. Overlay components — Select, Menu, Popover, and Tooltip — are portalled to `document.body` and receive z-index values from Zag.js's internal layer stack. Chakra's token scale assigns `z-index: 1000` to dropdowns and `z-index: 1400` to modals.

This creates a systemic problem: any portalled overlay that opens inside a modal or dialog renders *behind* it, because the dropdown z-index (1000) is lower than the modal z-index (1400). Both elements live at the same DOM level (`document.body`), so there is no stacking context inheritance to rely on.

Developers worked around this with ad-hoc `zIndex` props scattered across ~30 consumer components (`zIndex="popover"`, `zIndex="1600"`, `zIndex={1501}`, etc.). These overrides were:

- **Fragile** — each new overlay-in-modal usage required discovering and applying the workaround
- **Inconsistent** — different values used across the codebase with no rationale
- **Incomplete** — nested overlays (e.g., Select inside Popover inside Dialog) couldn't be solved with a single flat value

### Why not CSS custom properties?

Portal-based overlays move DOM nodes to `document.body`, which breaks CSS custom property inheritance from ancestor components. A CSS-only solution cannot propagate depth through portals.

### Why not Chakra's built-in z-index tokens?

Chakra's z-index scale (`dropdown: 1000`, `popover: 1500`, `modal: 1400`) doesn't account for overlays-inside-overlays. The tokens are flat, not depth-aware. And Zag.js overrides them with inline `--z-index` styles at runtime anyway.

## Decision

We will use a React context-based depth counter (`OverlayDepthContext`) paired with a `useOverlayZIndex()` hook to assign incrementing z-index values to nested overlay components.

### How it works

1. **Base value:** 2000 (above all Chakra built-in z-index tokens)
2. **Increment:** +10 per nesting level
3. **Context propagation:** Each overlay component (`PopoverContent`, `SelectContent`, `MenuContent`, `TooltipContent`) calls `useOverlayZIndex()`, which reads the parent depth from context, increments it, and returns the computed z-index
4. **Provider wrapping:** Each overlay wraps its children in `<OverlayDepthContext.Provider value={depth}>` so nested overlays receive the incremented depth
5. **Ref callback enforcement:** The z-index is applied via `node.style.setProperty("z-index", zIndex, "important")` on the Positioner element, overriding Zag.js's inline styles

| Nesting level | z-index |
|---|---|
| Depth 1 (e.g., standalone Popover) | 2010 |
| Depth 2 (e.g., Menu inside Popover) | 2020 |
| Depth 3 (e.g., Select inside Menu inside Popover) | 2030 |

### Escape hatch

Consumers can provide their own `<OverlayDepthContext.Provider value={N}>` to override the depth for edge cases.

## Consequences

**Positive:**
- All overlay-in-modal/dialog cases work correctly without any consumer-side code
- Nested overlays stack correctly regardless of depth
- Removed 30 ad-hoc `zIndex` overrides from consumer components
- New overlay usages automatically get correct stacking — no workaround discovery needed

**Negative:**
- `!important` on z-index prevents consumers from lowering the value via normal CSS (the escape hatch via context still works)
- The base value of 2000 is a magic number that must stay above Chakra's highest z-index token; a Chakra upgrade changing token values could require updating it
- React context doesn't cross iframe boundaries (not currently a concern)

**Neutral:**
- The increment of 10 allows ~100 nesting levels before reaching z-index 3000, which is far beyond any realistic UI scenario
- The solution is specific to Chakra/Zag.js — a different UI library would require a different approach

## References

- GitHub issue: https://github.com/langwatch/langwatch/issues/2519
- PR: https://github.com/langwatch/langwatch/pull/2547
- Chakra UI z-index tokens: https://www.chakra-ui.com/docs/theming/z-index
- Zag.js layer stack: https://zagjs.com/overview/composition#nested-machines
