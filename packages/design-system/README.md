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
3. Write `src/components/<name>.stories.tsx` beside it. A directory of
   components (`icons/`, `messages/`) takes one story named after the
   directory.
4. Add or extend a scenario in `specs/design-system/` and bind it to a test.

`specs/design-system/component-catalogue.feature` is enforced: a component with
no story, or a story that will not render in both colour modes, fails
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

## Checklist

- Tokens, never literals: `fg.muted`, `border.emphasized`, `red.solid` — no hex.
- No `@chakra-ui/*` or `@emotion/*` import outside this package, tests included: take layout primitives from `./primitives`, wrapped parts from their own subpath, and mount tests with `renderWithDesignSystem` from `./testing`.
- Sizes and variants are props, not copies of the component.
- Accessible name on every control; decorative icons carry `aria-hidden`.
- Copy follows `dev/docs/best_practices/copywriting.md`: no abbreviations, no
  internals.

## Catalogue taxonomy

**Foundations** are tokens and non-component rules (colour, the logo, icons,
overlay depth). **Primitives** are small accessible building blocks.
**Components** are named reusable controls with a stable API. **Patterns** are
app-independent compositions this package already owns.
