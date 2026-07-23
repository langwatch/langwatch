# ADR-062: Console shell visual language

**Date:** 2026-07-23

**Status:** Accepted

## Context

The app shell went through several visual iterations on the navigation
redesign branch, converging on a "floating card" language: the sidebar sat
on a gray page ground, the content floated beside it as a raised, rounded
card carrying its own header, and Langy's dock joined as a second card
wearing a shared inset (`SHELL_CARD_INSET`). The chrome was deliberately
recessive — light-on-light, one brand-colored notch on the active row.

That direction had structural costs. The card geometry leaked into every
surface that touched the shell's edge: banners curved a top-left corner to
continue the card's radius, the docked panel needed two geometries (inset
card under a shell, flush pane on full-screen tools) with a claim mechanism
deciding which, and the inspector drawer mirrored that split. And as a
direction it never stopped reading as a variation of the light workspace
around it — the chrome and the work competed on the same ground.

## Decision

We will style the shell as a **console**: a full-height warm-ink navigation
rail (`#1C1917`, keyed to the orange brand rather than the dark theme's
indigo-tinted zinc) that keeps the same ink in the light and dark themes,
beside a flat, edge-to-edge workspace that responds to the theme. The
chrome is the constant; the workspace is the variable.

Mechanically:

- The rail column is a **dark-scoped subtree** (`className="dark"` +
  `data-theme="dark"` on the rail Box). Chakra's semantic tokens resolve
  their dark-theme form for everything rendered inside — badges, pills,
  progress tracks — with no per-component ink styling. Rail-specific
  values live in single-value `nav.*` semantic tokens (no `_light`/`_dark`
  pairs, because the rail does not change with the theme).
- The workspace is flat: no card, no insets, no chrome shadows. The header
  is a hairline-separated row at the top of the content column.
- The active row carries a small brand-orange **indicator light** (LED with
  a soft glow) instead of the notch; section labels are set in the utility
  monospace face (`fonts.mono`), small, uppercase, widely tracked. Brand
  orange appears in exactly two chrome places — the LED and the usage
  gauge — with dev-/ops-only badges outside the budget.
- Langy's dock is a **flush full-height pane everywhere**. The
  shell-vs-page distinction survives only as "who reserves the width"
  (`dockShellClaims`); `SHELL_CARD_INSET` and `LANGY_DOCK_GAP` are gone,
  and the drawer-companion strip keeps its own constants
  (`LANGY_COMPANION_INSET`, `LANGY_COMPANION_GAP`).

## Rationale / Trade-offs

A theme-invariant rail gives the product a fixed identity anchor — the
instrument panel does not change when the room lights do — and gives the
data-dense workspace the full contrast range. The dark-scoped subtree is
what makes the invariance cheap: one attribute on one container instead of
ink-aware variants of every rail component. The cost is that portaled
content (tooltips, popovers) escapes the scope and renders app-themed,
which is acceptable because those surfaces overlay the workspace.

Flattening the dock to one geometry deletes a real class of drift (two dock
shapes, two inspector frames, banner corners chasing a card radius) in
exchange for giving up the "twin cards" composition, which only existed to
serve the card language.

## Consequences

- Chrome surfaces must not reintroduce card vocabulary: no rounded
  top-left corners on banners, no insets between shell columns, no
  brand color outside the two budgeted places.
- Components rendered inside the rail inherit dark-theme token resolution;
  new rail components should use `nav.*` tokens for rail-specific values
  and plain semantic tokens otherwise.
- The dock's geometry is the same on every page; anything anchored to the
  workspace's right edge (e.g. fixed bottom bars) must yield
  `LANGY_DOCKED_OFFSET` while the dock is open.

## References

- Specs: `specs/navigation/shell-visual-language.feature`,
  `specs/langy/langy-panel-layout.feature`
- Related ADRs: none — this supersedes the un-ADR'd floating-card
  iterations on the same branch.
