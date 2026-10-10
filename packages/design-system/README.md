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

**One inset frame, one content ground, one raised panel: separate regions with a
hairline before colour. Dark surfaces follow GitHub Primer; colour carries
status or accent, and chrome belongs to the ground it frames.**

Use Chakra's semantic names in new code. The dark gray scale uses the Primer
reference values below; its light values are unchanged. `grayScale` selects the
mode before Chakra's roles resolve, so a raw gray step also follows the theme.
`zinc` is only the backing dark scale retained for compatibility.

| Region                                                     | Chakra role                      | Dark              | Separation                              |
| ---------------------------------------------------------- | -------------------------------- | ----------------- | --------------------------------------- |
| App frame, sidebar, top bar                                | `bg.page` (one documented extra) | #010409           | `border.muted`                          |
| Content, section nav, page title                           | `bg`                             | #0d1117           | hairline; title adds it after scrolling |
| Cards, tables, drawers, dialogs, menus, popovers, tooltips | `bg.panel`                       | #151b23           | `border`                                |
| Wells, hover, small controls                               | `bg.muted` / `bg.emphasized`     | #212830           | `border`                                |
| Table header/body, EmptyState                              | inherit owning container         | no extra ground   | `bg.muted` hover                        |
| Default / muted hairline                                   | `border` / `border.muted`        | #3d444d / #2f3742 | structure, not elevation                |
| Primary / secondary text                                   | `fg` / `fg.muted`                | #f0f6fc / #9198a1 | AA on all four grounds                  |

`bg.page` is the sole extra surface role: Chakra's `bg` cannot represent both
Primer's inset shell and its distinct content canvas. `bg.subtle` shares the
raised value in dark mode. `bg.muted` and `bg.emphasized` share the control value;
the app uses at most four dark grounds. Status surfaces and per-palette roles
retain their meaning and colours. Overlay header/body/footer all inherit one
opaque `bg.panel`; only the sticky title uses glass.

Primer's adjacent surface gaps are deliberately below 8 CIELAB L*. The old
minimum forced washed-out elevated panels, so the test now checks the four
reference colours, ascending 3–8 L* steps, shared well/control ground, AA text
and status contrast, and visible structural hairlines. `border.emphasized`
remains a stronger edge for focus/meaningful outlines and meets 3:1 against
controls; ordinary structural borders are intentionally quieter.

### Deprecated aliases — use the Chakra name

| Compatibility name                                        | Use instead                                                   |
| --------------------------------------------------------- | ------------------------------------------------------------- |
| `bg.surface`, `bg.rail`                                   | `bg`                                                          |
| `bg.card`, `bg.overlay`, `bg.inputHover` (old raised use) | `bg.panel` (`bg.inputHover` now aliases `bg.muted` for hover) |
| `bg.nested`, `bg.raised`, `bg.softHover`, `bg.hover`      | `bg.muted`                                                    |
| `bg.control`, `bg.input`, `bg.selected`                   | `bg.emphasized`                                               |
| `bg.stripe`                                               | `bg.subtle`                                                   |
| `border.card`, `border.control`                           | `border`                                                      |
| `border.nested`                                           | `border.muted`                                                |
| `border.strong`                                           | `border.emphasized`                                           |

A table is not a stack of wells: its ordinary rows and header inherit its
container. Prefer removing call-site background overrides. New shared
components use Chakra names; aliases keep existing module call sites working.

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
