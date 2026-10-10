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

### Surface ladder

Use these four levels in order. Each child has a distinct ground and an edge
against its parent; do not reuse the card ground for every nested element.
`Foundations/Tokens → Surface ladder` shows the same nesting in both modes.

| Level                      | Background   | Light    | Dark     | Matching edge (light / dark)          |
| -------------------------- | ------------ | -------- | -------- | ------------------------------------- |
| Page                       | `bg.page`    | gray.150 | zinc.950 | —                                     |
| Card                       | `bg.card`    | white    | zinc.750 | `border.card`: gray.300 / zinc.600    |
| Row group / well           | `bg.nested`  | gray.100 | zinc.600 | `border.nested`: gray.400 / zinc.500  |
| Chip / input / inline code | `bg.control` | gray.200 | zinc.500 | `border.control`: gray.450 / gray.300 |

The dark ladder increases CIELAB L* by **10.22, 12.12, 12.26** per step;
relative-luminance differences are **0.01238, 0.02836, 0.05211**.
Light alternates pale grounds so nesting reads without shadows, with
relative-luminance differences **0.16609, 0.09155, 0.10672**.
These are surface-separation measurements, not text contrast ratios.
`fg`, `fg.muted`, `fg.subtle` and `fg.<status>` retain at least 4.5:1 on all
four grounds in both modes. The lowest neutral-text ratios are 5.30:1 light
and 4.86:1 dark. Use a status background for palette-role status chips.

Compatibility names follow the ladder: `bg.surface` → page; `bg.panel` → card;
`bg.raised`, `bg.muted`, `bg.subtle`, `bg.softHover` → nested;
`bg.emphasized`, `bg.input` → control; `bg.inputHover` → card.
`border`, `border.muted`, `border.subtle` → card; `border.emphasized` → nested;
`border.strong` → control. Navigation rails and status grounds keep their own roles.

Card `outline` and `elevated` use the card ground and edge; `elevated` keeps
its shadow. Card `subtle` uses the nested ground and edge. Small surfaces
inside that card use `bg.control` and `border.control`.

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
