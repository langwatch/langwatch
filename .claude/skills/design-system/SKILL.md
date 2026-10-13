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

0. **The design system is the source of truth for components** (Alex,
   2026-10-10). Every component comes from `@langwatch/design-system`; a
   module never hand-rolls one. A missing need (a variant, a prop) is added to
   the design-system component first, with its story, never as a local copy:

   | Need                               | Use                                                                         |
   | ---------------------------------- | --------------------------------------------------------------------------- |
   | Page or section notice             | `Banner` + `BannerAction` (`/banner`)                                       |
   | Form or task message, load failure | `Alert` (`/primitives`), `status` + `size="sm"` when dense                  |
   | Something just happened            | `toaster` (`/toaster`)                                                      |
   | Dialog, confirm                    | `Dialog` (`/dialog`), `/confirm-dialog`, `/delete-confirmation-dialog`      |
   | Drawer                             | `Drawer` (`/drawer`)                                                        |
   | Card, tile, footer buttons         | `Card`, `CardGrid` (`/card`), `/resource-tile`, `ActionRow` (`/action-row`) |
   | Empty or no-access state           | `EmptyState` (`/primitives`), `/no-data-info-block`, `/restricted-access`   |
   | Menu, popover                      | `/menu`, `/popover`                                                         |
   | Picker                             | `/select`, `/option-list`, `/scope-chip-picker`, `/provider-model-selector` |
   | Table, list page                   | `/list-table`, `/list-page`, `/pagination`                                  |

   `Drawer`, `Dialog` and `Card` are **callable shapes with closed props** (no style prop, so a
   restyle does not compile). Teach and write only those; their props, size and padding scales
   and the legacy shapes being removed are in `references/component-apis.md`. The old part
   statics (`Drawer.Root`, `Dialog.Root`, `Card.Root`), the `studio-drawer` and `studio-dialog`
   subpaths and the `DetailDrawerHeader`, `SettingsCard` and `WorkflowCard` aliases are legacy.

   A `Box`/`Flex`/`Card` with a status tint, border and icon is a hand-rolled
   alert: replace it. Never restyle an alert at the call site
   (`dev/docs/best_practices/alerts-toasts-and-field-errors.md`).

1. **Only `packages/design-system` imports `@chakra-ui/*` or `@emotion/*`.**
   Feature browsers, apps and tests import `@langwatch/design-system/<subpath>`
   (named subpaths, never a deep path). `no-direct-chakra` is ruled but there is no
   such rule in `packages/oxlint-rules` yet (the record's §2 and §17 wording differ on
   when it lands), so nothing mechanical stops you: hold the line by hand. New code
   never adds a direct import.
2. **Primitives and wrappers.** `@langwatch/design-system/primitives`
   re-exports most of Chakra's primitives and raw parts unchanged (`Box`, `Flex`,
   `Table`, `Heading`, ...) until real components replace them. Not all are
   unchanged: `Button` is the design system's own (it fixes the loading label for
   assistive technology), and `Card` there is `CardParts`, the legacy composable
   family. The product `Card` is `@langwatch/design-system/card`: same name, different
   thing. A wrapped part (Checkbox, Switch, Tooltip, Menu, Dialog, Avatar, Drawer)
   comes from its own subpath. `Alert` and `EmptyState` are compound: use their parts
   (`Alert.Root`, `Alert.Title`...). Look for a named component before using a primitive.
3. **Colour is made only here.** Elsewhere, name a semantic token: `fg.*`,
   `bg.*`, `border.*`, `fg|bg|border.<status>`, `<palette>.<role>` (`red.solid`),
   `chart.N`, `accent.*`, `bg.scrim`. Never a scale step, hex, `rgb()` or bare
   white or black (`no-raw-color`: ruled, and like `no-direct-chakra` not in
   `packages/oxlint-rules` yet). A library that needs a string takes
   `useToken` / `system.token.var` (a CSS variable that follows the mode) or
   `getRawColorValue` / `useColorRawValue` from `@langwatch/design-system/color-mode`
   (a literal for the current mode). A new colour need is a semantic token in
   `src/system/config.ts`, a light and a dark value, and a story row.
4. **Components take props or a query result. They never fetch**, never import
   a contract, a router or a feature (the package has no contract dependency, so
   it restates contract types structurally). Data meets layout in a module's
   `ui/sections`, see `browser-module`.
5. **A component two modules need goes here, not into a kit.** Kits are gone
   (§3.4). Adding one: one kebab-case file under the right concern folder of
   `src/components/` (`forms/`, `layout/`, `overlays/`, `display/`, `states/`, ...),
   a stable subpath in `package.json` `exports` mapping to it, a `.stories.tsx` beside it covering each real
   state (default, loading, empty, error, disabled, long text, narrow), and a
   scenario in `packages/design-system/specs/`. The catalogue spec fails a
   component with no story or one that will not render in both modes.
6. **Native elements, styled.** An interactive thing is a `button`, `a` or
   `input` styled through the system, never a `div` with a role. In-app links
   use `@langwatch/browser-host/link` or a component handed `onNavigate`.
7. **Tests mount `renderWithDesignSystem`** from
   `@langwatch/design-system/testing`, not Chakra's default provider.

## Where to look before writing a component

Check here first, every time: reuse what exists, and build a component any
other module would reuse here rather than in your module (rule 5).

- `packages/design-system/src/components/<concern>/`: one file per component, grouped
  (`layout/card.tsx`, `overlays/views/drawer-view.tsx`, `layout/list-table.tsx`,
  `layout/section-navigation-frame.tsx`, ...). Import by the stable subpath, not the path.
- `packages/design-system/src/system/` (tokens, recipes, `config.ts`),
  `src/provider/`, `src/color-mode/`, `src/testing/`.
- `packages/design-system/src/index.ts` and sibling files: formatters and small
  pure helpers (money, metrics, slugify, text overflow). Do not reimplement.
- `pnpm --filter @langwatch/design-system storybook`, or `/design-system` while
  the dev server runs, to see what each looks like.

## Component API reference

`references/component-apis.md` (beside this file): current Drawer, Dialog, Card and footer-row
props, the width and padding scales, close and busy semantics, and the legacy-to-current table.
Read it before writing or converting any drawer, dialog or card.

`references/internal-console.md`: the separate internal-console design language (haven and simulator
consoles), for when the screen is not the product.

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
- **The `chakra-ui-builder` and `chakra-ui-refactor` skills use `@chakra-ui/react`.** They are
  for editing files inside `packages/design-system` only, where that import is allowed. In a
  module or app, never copy their examples (rule 1).
- **A colour from a scale step or hex "just here".** Add a semantic token.
- **A `*Banner`, `*Notice` or `*Callout` in a module that draws its own box.**
  It wraps `Banner` or `Alert` and adds only words and wiring, or it goes.
- **Pattern docs lag the record.** Where one disagrees, the record wins:
  browser packages are `*-browser` (§16). `dev/docs/best_practices/drawers.md` exists
  and covers drawer routing and chrome; drawers are routed singletons, see
  `browser-module`, and their props are in `references/component-apis.md`.
- **Fetching or reading `*HostApi` inside a shared component.** The owner lends
  it by token (§10.1) and the consumer renders what it is handed.
- **Mail and the internal consoles have their own design languages.** Email: the
  `mail-template` skill. Haven and simulator consoles: `packages/design-system-internal`
  (React and CSS, no Chakra; see its README and ADR-160). Neither uses the product look.
