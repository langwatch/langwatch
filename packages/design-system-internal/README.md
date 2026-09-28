# @langwatch/design-system-internal

The look of every internal console: the haven hub and stack home, the IdP
simulator, the mail sink, and the chrome of the mail room and Storybook
([ADR-160](../../dev/docs/adr/160-internal-consoles-are-go-served-react.md)).
It is the hub's **paper** language: cream paper, warm ink, one orange, serif
headings, mono details. React only; no Chakra, no product design system.

This README is the design brief. A console that departs from it is a defect in
the console, not a variant.

## Exports

```
@langwatch/design-system-internal/styles.css   tokens, reset, base type, component classes
@langwatch/design-system-internal              the React components below
```

A console imports `styles.css` once in its entry and uses components. It
writes no colour, font size, radius, shadow or spacing literal of its own;
layout glue (grid columns, a max width) is the only CSS a console may add, in
one `app.css`, using the tokens.

## Tokens

All are CSS custom properties on `:root`, with a dark set under
`@media (prefers-color-scheme: dark)` and `[data-theme="dark"]`. Values start
from the hub's (`tools/thuishaven/adapters/dashboard/template.go:16-32`).

- **Paper:** `--paper` (page), `--paper-soft` (panel header, table head,
  hover), `--paper-deep` (pressed, code).
- **Ink:** `--ink-900` (headings, body), `--ink-600` (secondary), `--ink-500`
  (labels), `--ink-300` (placeholders, meta). Body text is never lighter than
  `--ink-600`.
- **Line:** `--line` (every hairline), `--line-strong` (inputs, focusable
  edges).
- **Brand:** `--brand`, `--brand-deep`, `--brand-soft`. Orange marks one
  thing per view: the primary action or the current selection.
- **State:** `--moss` ok/live, `--amber` starting/warning, `--rust`
  down/error, each with a `-soft` fill. State is never colour alone: a dot
  always sits beside a word.
- **Type:** `--font-serif` (Sentient, headings only), `--font-sans` (body,
  controls), `--font-mono` (ports, hostnames, ids, logs, code).
  Scale: `--text-xs` 11px, `--text-sm` 12px, `--text-md` 14px (body),
  `--text-lg` 16px, `--text-xl` 20px, `--text-2xl` 28px (page title, serif).
  Line height 1.5 for body, 1.2 for headings; tabular numerals for numbers.
- **Space:** a 4px scale, `--space-1` 4 … `--space-2` 8, `--space-3` 12,
  `--space-4` 16, `--space-5` 20, `--space-6` 24, `--space-8` 32,
  `--space-12` 48. Nothing off the scale.
- **Radius:** `--radius-sm` 6px (controls, badges, code), `--radius-md` 10px
  (panels), `--radius-full` (dots, pills).
- **Shadow:** `--shadow` for overlays only (menus, dialogs, toasts). Panels
  are flat: a border, no shadow.
- **Focus:** `--focus-ring`: 2px `--brand` outline, 2px offset, on
  `:focus-visible` only, on every interactive element.

## Borders and padding: the rules

These are where consoles drift, so they are rules, not taste.

1. **One hairline.** Every border is `1px solid var(--line)`. No 2px borders,
   no border plus shadow on the same box, no coloured borders except the
   focus ring and an input in its error state (`--rust`).
2. **No double lines.** Where two bordered things meet, one border draws the
   line: stacked panels use a gap (`--space-4`) not touching borders; a table
   inside a panel drops its own outer border and the panel's padding (the
   table is flush, its cells carry the inset); a panel header's bottom border
   is the only line between header and body; the last row of a list or table
   has no bottom border.
3. **Inset follows the edge.** Content inside a bordered box is inset by the
   same amount on the left as the box's header and its rows: `--space-4`
   horizontally in panels, table cells and list rows alike, so every left
   edge in a panel lines up. Vertical padding: panel header `--space-3`,
   panel body `--space-4`, table cell and list row `--space-2` plus 2px
   (10px; the one allowed half-step, for 36px rows).
4. **Radius nests.** An element inside a rounded panel that touches the
   panel's edge (a flush table's head, a header's background) is clipped by
   the panel (`overflow: hidden`), never given its own radius.
5. **Controls share a height.** Buttons, inputs, selects and segmented
   controls are 32px (`sm` 28px) with `--space-3` horizontal padding, so a
   row of mixed controls aligns without per-item fixes. Icon-only buttons are
   square.
6. **Gaps, not margins.** Layout spacing comes from `gap` on flex/grid
   parents (`Stack`, `Inline`, `Grid`); components carry no outer margin.
7. **Page frame.** Content max width 1200px (a log or table view may go full
   width), page padding `--space-8` desktop and `--space-4` under 720px,
   sections separated by `--space-8`.
8. **Truncate, don't wrap, in rows.** Hostnames, paths and ids in a row
   truncate with an ellipsis and carry the full value in `title`; they never
   push a row to a second line or the page wider than the viewport.

## Components

Each is small, typed with named props, and styled only by `styles.css`
classes (`ds-` prefix).

- **Layout:** `Page` (frame, title, subtitle, actions slot, nav slot),
  `TopBar` (console name, stack slug, links to the other consoles, theme
  toggle), `Section`, `Stack`, `Inline`, `Grid`.
- **Surfaces:** `Panel` (optional `title`, `meta`, `actions`, `flush`),
  `EmptyState`, `Callout` (info / warning / error).
- **Data:** `Table` (sticky head, flush in a panel, row hover, empty row),
  `KeyValue` (label column + value column, mono values, copy button), `List`,
  `Code` (inline) and `CodeBlock` (with copy), `LogView` (mono, level
  colouring, follow tail, wraps long lines, virtualises past 2,000 lines).
- **Status:** `StatusDot` + label (`live`, `starting`, `down`, `unknown`),
  `Badge` (neutral, brand, ok, warn, error), `Meter` (for memory and disk).
- **Controls:** `Button` (primary, secondary, ghost, danger; `sm`/`md`;
  loading state), `IconButton`, `Input`, `Select`, `Textarea`, `Checkbox`,
  `SegmentedControl`, `Tabs`, `CopyButton`, `ConfirmButton` (second click
  within 3 s confirms; used for restart, down and destroy), `Link` (external
  links show an arrow and open in a new tab).
- **Overlays:** `Menu`, `Dialog`, `Toast`.
- **Theme:** `ThemeToggle` (system / light / dark, persisted in
  `localStorage` under `lw-internal-theme`, set as `data-theme` on `<html>`).

## The gallery

`pnpm --filter @langwatch/design-system-internal dev` serves a gallery page of
every component in every state, light and dark side by side. It is the
visual review surface: a component change is checked there first.

## Verifying a screen

A console change is done when it has been looked at, not when it compiles.
Screenshot each changed view at 1280px and 390px, light and dark
(`pnpm --filter <app> screenshot`, which runs Playwright against the built
bundle), open the images, and check against the rules above: one hairline, no
double lines, aligned left edges, controls level, nothing overflowing,
nothing wrapped in a row, focus rings visible when tabbing.
