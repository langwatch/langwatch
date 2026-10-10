# Design system

`@langwatch/design-system` owns LangWatch's browser-safe Chakra system, shared
components, and their documentation surface. It must not import the host app,
a feature package, routing, transport, or server code.

## The workshop

```bash
pnpm --filter @langwatch/design-system storybook   # standalone, port 6006
```

While the browser application's Vite dev server runs (`pnpm dev:hmr`, `haven up --hmr`
or `pnpm dev:ui`),
`/design-system` opens the same workshop. Storybook starts on the first visit
to that address, so it costs the dev server nothing at boot, and
`LANGWATCH_SKIP_STORYBOOK=1` turns it off entirely.

Stories mount `DesignSystemProvider`, not Chakra's default system, so a story
shows the tokens a consuming application receives. The toolbar switches between
System, Light and Dark. The accessibility addon runs on every story.

## Adding a component

1. One file per component in `src/components/`, named in kebab case.
2. Add its named subpath to `exports` in `package.json` — consumers import
   `@langwatch/design-system/<name>`, never a deep path.
3. Write `<name>.stories.tsx` beside it, titled into a sidebar section (below)
   and with `parameters.usage` saying when to use it and what to use instead.
   A directory of components (`icons/`, `messages/`) takes one story named
   after the directory.
4. Add or extend a scenario in `specs/design-system/` and bind it to a test.

`specs/design-system/component-catalogue.feature` and
`specs/storybook-showcase.feature` are enforced: a published entry point with no
story, a story outside the sidebar sections, a component page with no usage, or
a story that will not render in both colour modes fails
`pnpm --filter @langwatch/design-system test`.

## What a story owes

Every realistic state the component actually has: default, and whichever of
loading, empty, error, disabled, long text and narrow width apply. Where the
component takes variants or sizes, one story shows them side by side. Use CSF3,
keep `tags: ["autodocs"]`, and leave controls on for the props a person would
change.

## Colour

Tokens live in `src/system/config.ts`; the scale in `src/color-mode`. A new colour
need is a semantic token here, with a light and a dark value from the palette and
a row in `colour.stories.tsx`, never a literal at the call site. Code that must
hand a library a string uses Chakra's `useToken` or `system.token.var` (a CSS
variable), or `getRawColorValue` / `useColorRawValue` for a literal in the current mode.

### Which surface for which region

The palette follows production main (`e683dd9ea5`), including its inherited
Chakra colours. Raw gray steps do not change with mode; semantic roles select
gray in light mode and zinc for dark surfaces. Brand orange is `#ED8926`.

| Role                                           | Light   | Dark    |
| ---------------------------------------------- | ------- | ------- |
| bg.page                                        | #f1f5f9 | #10101a |
| bg.surface                                     | white   | #080812 |
| bg (Chakra default)                            | white   | black   |
| bg.panel / bg.card / bg.overlay / bg.raised    | white   | #1a1a24 |
| bg.muted / bg.nested / bg.softHover / bg.hover | #f1f5f9 | #15151e |
| bg.input / bg.control                          | #e2e8f0 | #10101a |
| bg.emphasized                                  | #e2e8f0 | #3a3a44 |
| bg.selected / nav.bgActive                     | #e2e8f0 | #282832 |
| bg.rail                                        | #e7ecf2 | #15151e |
| bg.subtle / bg.stripe                          | #f8fafc | #10101a |
| border / border.card / border.control          | #e2e8f0 | #3a3a44 |
| border.muted / border.nested                   | #f1f5f9 | #282832 |
| border.emphasized / border.strong              | #cbd5e1 | #565664 |
| fg                                             | #111113 | #f1f5f9 |
| fg.muted                                       | #3d3d4d | #cbd5e1 |
| fg.subtle / nav.marker                         | #5c5c6e | #9CA3AF |

Main’s warning surfaces/text/borders use orange; status.warning and
status.pending use yellow. Structural hairlines preserve main’s subtlety and
do not claim 3:1 contrast. Do not assume every status or subtle-text pairing
meets AA. Menus, drawers and dialogs use an opaque panel; controls use input.

The [complete main comparison](docs/main-colour-parity.md) lists raw scales,
semantic tokens, inherited defaults, branch-only aliases and feature themes.

### Sticky page titles

`PageLayout.Header` stays at the top of its scrolling content panel. Its
65% content-ground glass and 16px backdrop blur reveal passing content;
`--lw-panel-alpha` and `--lw-backdrop-blur` restore opacity and remove blur for
reduced graphics. A reserved 1px hairline starts transparent and fades in
after scrolling without changing layout. Reduced motion disables the fade.
Section headers share the same behaviour. `withBorder={false}` opts out.

## Checklist

- Tokens, never literals: `fg.muted`, `border.emphasized`, `red.solid` — no hex.
- No `@chakra-ui/*` or `@emotion/*` import outside this package, tests included: take layout primitives from `./primitives`, wrapped parts from their own subpath, and mount tests with `renderWithDesignSystem` from `./testing`.
- Sizes and variants are props, not copies of the component.
- Accessible name on every control; decorative icons carry `aria-hidden`.
- Copy follows `dev/docs/best_practices/copywriting.md`: no abbreviations, no
  internals.

## The workshop's sidebar

Filed by what a developer reaches for, in the order of `.storybook/preview.tsx`:
Start here (introduction, component gallery), Foundations (tokens, colour,
typography, gradients, icons), Primitives, Inputs and forms, Data display,
Feedback, Overlays, Navigation and layout, Chrome and app shell, Brand, Patterns
(whole screens) and Consistency (do and don't, the scoreboard). Stories sit
beside what they document: a component, the tokens in `src/system`, or the
workshop's own pages in `src/workshop`.

Every docs page shows how many files import the component, counted from the
import sites when Storybook starts or builds (`.storybook/adoption.ts`;
`node .storybook/adoption.ts` prints the whole inventory).

## Section navigation

`SectionNavigationFrame` pairs a 176px text rail with the page content on `bg.card`.
Section and sub-page titles share a borderless 48px row. The vertical `border.muted`
divider starts below it. Links are 32px tall; hover changes text colour only.
One 3px `nav.marker` marker follows the current link, including nested lists, in 180ms.
It jumps for reduced motion and scrolls with the links. Its outer edge is flat,
and its inner edge has a 2px radius. A collapsed rail retains labelled icon links.

## Option lists

Menu, select and combobox recipes share `option-list.recipe.ts`: 4px container
padding, 8px item side padding, a 32px minimum row and a subtle `bg.hover` fill.
Custom popover pickers use `OptionItem` from `./option-list` for the same treatment.

When the unfiltered options have loaded empty, disable the picker and associate
its trigger with `EmptyOptionsHint` using `aria-describedby`. Supply a creation
link through `action`. Do not turn loading, failure, filtered no-match results or
free-text entry into an empty collection.
