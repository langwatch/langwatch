# Design system

`@langwatch/design-system` owns LangWatch's browser-safe Chakra system, shared
components, and their documentation surface. It must not import the host app,
a feature package, routing, transport, or server code.

## The workshop

```bash
pnpm --filter @langwatch/design-system storybook   # standalone, port 6006
```

While the browser application's dev server runs (`pnpm dev` or `pnpm dev:ui`),
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

**One ground, one card, one overlay: levels lift toward the reader only for a
real container or control. Separate regions with a hairline before colour;
chrome belongs to the ground it frames, and interaction is a quiet tint.**

| Region                                               | Surface                                | Edge / state                                                   |
| ---------------------------------------------------- | -------------------------------------- | -------------------------------------------------------------- |
| Body, global sidebar, top bar                        | `bg.page`                              | `border.card` where needed                                     |
| Content, section rail, page title                    | `bg.surface`                           | hairline; sticky header adds it after scrolling                |
| Card, bordered ListTable                             | `bg.card`                              | `border.card`                                                  |
| Table header and body rows, EmptyState               | transparent; container owns the ground | `bg.hover`, `bg.selected`, `bg.stripe` tints                   |
| Well, grouped content inside a card, code block      | `bg.nested`                            | `border.nested`                                                |
| Input, select, textarea, checkbox, chip, inline code | `bg.control`                           | `border.control`; checked/status meaning retains palette roles |
| Drawer, dialog, menu, popover, tooltip, select menu  | opaque `bg.overlay` (= card)           | `border.card`; headers/footers share the overlay               |
| Tabs / segmented control                             | transparent / `bg.control` track       | quiet selected tint; no new content ground                     |

A table is not a stack of wells: its header, ordinary rows and empty state
stay on its container. Hover is a 4% foreground tint, selection 8%, stripes 2%;
none introduces a new elevation. Status badges retain their semantic palette
fill; colour communicates meaning there, not depth. A neutral badge uses the
control ground. Prefer removing a call-site background override to adding one.
The sticky page title is the intentional glass exception: it samples the same
content ground, with the reduced-graphics switch restoring opacity.

### Surface ladder

The dark material is blue ink: OKLCH hue **250°**, with chroma tapering from
**0.020 to 0.014** across the four surface steps. The values below are sRGB
hexes derived from that curve; the Tokens story shows hex and measured OKLCH
swatches together. Light values are unchanged.

| Level          | Background   | Light    | Dark               | Matching edge  |
| -------------- | ------------ | -------- | ------------------ | -------------- |
| App frame      | `bg.page`    | gray.100 | #070e16 · zinc.950 | —              |
| Content ground | `bg.surface` | white    | #070e16 · zinc.950 | border.card    |
| Card / overlay | `bg.card`    | white    | #192028 · zinc.800 | border.card    |
| Nested well    | `bg.nested`  | gray.100 | #2d343b · zinc.700 | border.nested  |
| Small control  | `bg.control` | gray.200 | #42484f · zinc.600 | border.control |

Dark borders follow the same hue: `border.card` uses the nested step,
`border.nested` the control step, and `border.control` is #9a9fa5 (zinc.400).
The four dark surface targets are OKLCH lightness 0.16 / 0.24 / 0.32 / 0.40.
The existing separation test still requires each adjacent step to be at least
8 CIELAB L* apart, with at most 3 L* variation between gaps. Neutral and
status text remain AA on every level, and control edges have 3:1 contrast.
Orange and status palettes retain their values; blue ink is only the neutral
material beneath them.

Compatibility aliases: `bg.panel` → card; `bg.raised` / `bg.muted` → nested;
`bg.emphasized` / `bg.input` → control. `bg.surface` is the content ground,
not a card. `bg.subtle` is an auxiliary low-contrast tint, not another container
level. Use the canonical names for new components.

Card `outline`, `elevated` and `showcase` use `bg.card` / `border.card`;
`subtle` is a nested well on `bg.nested` / `border.nested`.

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
