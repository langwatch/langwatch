---
name: design-system
description: "Which component to use, where tokens and colour live, and why nothing but packages/design-system imports Chakra or Emotion. Use when someone says 'which component', 'design system', '@langwatch/design-system', 'import Chakra', '@chakra-ui/react', 'primitives', 'Box/Flex/Button', 'theme', 'token', 'colour', 'hex', 'fg.muted', 'dark mode', 'renderWithDesignSystem', 'story', 'list table', 'alert vs toast', 'no-direct-chakra', 'no-raw-color', or before writing any non-trivial screen, list, drawer, settings page or chart in a module's browser/ or apps/ui. Teaches the record (ARCHITECTURE.md section 2, design-system and colour rulings)."
user-invocable: true
argument-hint: "[component, token or pattern]"
---

# The design system

`@langwatch/design-system` (`packages/design-system`) is the one place that
touches Chakra v3. Read `dev/docs/ARCHITECTURE.md` §2 (the `design-system`
bullet; ADR-001, `packages/design-system/adrs/001-design-system-boundary.md`, as amended 2026-10-01) before building. Its own checklist is
`packages/design-system/README.md`.

## Rules that matter

1. **Only `packages/design-system` imports `@chakra-ui/*` or `@emotion/*`.**
   Feature browsers, apps and tests import `@langwatch/design-system/<subpath>`
   (named subpaths, never a deep path). Enforced by `no-direct-chakra`, which is
   ruled but not live yet (§10.2: it turns on once Chakra waves 2-3 are green).
   A few direct imports remain (some enterprise billing tests); they are debt,
   not precedent. New code never adds one.
2. **Primitives and wrappers.** `@langwatch/design-system/primitives`
   re-exports Chakra's primitives and raw parts unchanged (`Box`, `Flex`,
   `Button`, `Table`, `Heading`, ...) until real components replace them. A
   wrapped part (Checkbox, Switch, Tooltip, Menu, Dialog, Avatar, Drawer)
   comes from its own subpath. Look for a named component before using a
   primitive.
3. **Colour is made only here.** Elsewhere, name a semantic token: `fg.*`,
   `bg.*`, `border.*`, `fg|bg|border.<status>`, `<palette>.<role>` (`red.solid`),
   `chart.N`, `accent.*`, `bg.scrim`. Never a scale step, hex, `rgb()` or bare
   white or black (`no-raw-color`, ruled in §2 but, like `no-direct-chakra`, not
   in `packages/oxlint-rules` yet). A library that needs a string takes
   `useToken` / `system.token.var` (a CSS variable that follows the mode) or
   `getRawColorValue` / `useColorRawValue` from `@langwatch/design-system/color-mode`
   (a literal for the current mode). A new colour need is a semantic token in
   `src/system/config.ts`, a light and a dark value, and a story row.
4. **Components take props or a query result. They never fetch**, never import
   a contract, a router or a feature (the package has no contract dependency, so
   it restates contract types structurally). Data meets layout in a module's
   `ui/sections`, see `browser-module`.
5. **A component two modules need goes here, not into a kit.** Kits are gone
   (§3.4). Adding one: one kebab-case file in `src/components/`, a subpath in
   `package.json` `exports`, a `.stories.tsx` beside it covering each real
   state (default, loading, empty, error, disabled, long text, narrow), and a
   scenario in `packages/design-system/specs/`. The catalogue spec fails a
   component with no story or one that will not render in both modes.
6. **Native elements, styled.** An interactive thing is a `button`, `a` or
   `input` styled through the system, never a `div` with a role. In-app links
   use `@langwatch/browser-host/link` or a component handed `onNavigate`.
7. **Tests mount `renderWithDesignSystem`** from
   `@langwatch/design-system/testing`, not Chakra's default provider.

## Where to look before writing a component

- `packages/design-system/src/components/`: one file per component
  (`avatar`, `drawer`, `cached-view`, `section-navigation-frame`, `list-table`, ...).
- `packages/design-system/src/system/` (tokens, recipes, `config.ts`),
  `src/provider/`, `src/color-mode/`, `src/testing/`.
- `packages/design-system/src/index.ts` and sibling files: formatters and small
  pure helpers (money, metrics, slugify, text overflow). Do not reimplement.
- `pnpm --filter @langwatch/design-system storybook`, or `/design-system` while
  the dev server runs, to see what each looks like.

## Pattern docs to read first

`dev/docs/design/guidelines.md` (§4 screen layout), `dev/docs/design/components.md`,
and in `dev/docs/best_practices/`: `list-table.md`, `row-actions-overflow-menu.md`,
`selection-action-bar.md`, `scope-selector-and-badges.md` (scope pickers are
`ScopeChipPicker`, never a hand-rolled Select), `alerts-toasts-and-field-errors.md`
(never restyle an alert at the call site), `icon-button-labels.md`,
`copywriting.md` (no abbreviations, no internals), `async-processing-ui.md`.
Extend an existing pattern, do not invent one.

## Worked example

```tsx
// the shared list look: one component, tokens only
import { Table } from "@langwatch/design-system/primitives";
import { ListTable } from "@langwatch/design-system/list-table";
```

A page needing a rail across modules takes
`@langwatch/design-system/section-navigation-frame` (links and active one in,
no data) and each owning page renders it with the same entries (§10).

## Traps

- **`import { Box } from "@chakra-ui/react"` in a module.** Take it from
  `@langwatch/design-system/primitives`.
- **The `chakra-ui-builder` and `chakra-ui-refactor` skills tell you to import `@chakra-ui/react`.** In this repo that is wrong
  (rule 1); use them for Chakra v3 API knowledge only.
- **A colour from a scale step or hex "just here".** Add a semantic token.
- **Pattern docs lag the record.** Where one disagrees, the record wins:
  browser packages are `*-browser` (§16), and `best_practices/drawers.md` no
  longer exists: drawers are routed singletons, see `browser-module`.
- **Fetching or reading `*HostApi` inside a shared component.** The owner lends
  it by token (§10.1) and the consumer renders what it is handed.
- **Mail has its own expressive design system.** See the `mail-template` skill.
