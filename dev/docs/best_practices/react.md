# React

`apps/ui` is a Vite single-page app routed with `react-router`, not Next.js —
there is no `src/pages/` file-based routing, and no server components.

## Page vs Component Separation

- **Screens**: a feature's routable page content lives in its own `web`
  package, under `web/src/screens/`. A screen renders UI; it does not know its
  own URL, guard, or chrome.
- **Routes and hosts**: `apps/ui` owns routing, permission guards, and chrome
  composition, in `apps/ui/src/features/<area>/ui/sections/`. A route file
  wires one feature's screen(s) into the app's router and wraps them with the
  fixed order documented at the top of `apps/ui/src/ui/sections/ui-page.tsx`:
  host outermost, settings chrome next, permission guard innermost around the
  screen.
- **Components**: reusable UI logic lives beside the screen that owns it, or
  in the feature's own component directories — not duplicated into `apps/ui`.

## File Organization

- `hooks/` for hooks
- `components/` for components
- `screens/` for a feature's routable pages (in that feature's `web` package)
- `ui/sections/` for the app's routing/composition layer (in `apps/ui`)

## Hooks

- **Never return JSX from hooks.** Hooks manage state and logic; components render UI. A hook that returns JSX couples rendering to logic, hides the component tree, and makes both harder to test. Instead, return state/callbacks and let the consumer render the dialog/component explicitly.
- Use `.ts` for hooks, `.tsx` for components. If a hook file needs `.tsx`, that's a smell — the JSX should be in the consumer.

## Page headings

- **Page titles use `<PageLayout.Heading>` at its default size.** Never set a custom `size`/`fontSize` on a page title, and never hand-roll one with `<Text fontSize="lg">`. Consistent page titles are part of the design system, not a per-page decision. `PageLayout.Heading` omits `size`/`fontSize` from its props at the type level, so the typechecker rejects an override.
- A reusable component that renders its own title (for example the dataset editor) uses the Chakra `<Heading>` component at its default size, not a sized `<Text>`.
- `size` on a raw Chakra `<Heading>` is fine for _sub_-headings: drawer and dialog titles, card and section labels. The rule above is specifically about top-level page titles, not every heading on the page.
