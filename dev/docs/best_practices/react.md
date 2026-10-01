# React

`apps/ui` is a Vite single-page app routed with `react-router`, not Next.js —
there is no `src/pages/` file-based routing, and no server components.

## Page vs Component Separation

- **Screens**: a module's routable page content lives in its own browser
  package (`modules/<name>/browser`), as `ui/sections/` components that the
  module declares with `defineBrowserModule`. A screen renders UI; it does not
  know its own URL, guard, or chrome.
- **Routes and chrome**: `apps/ui` (`src/{main.tsx, shell/, styles/}`) owns
  routing, permission guards and chrome, built from the modules' declarations.
  A screen names the grant it `requires` and the release `flags` it sits behind;
  the shell wraps it, so a module never imports the router or hand-rolls a guard.
- **Components**: reusable UI belongs in the design system
  (`@langwatch/design-system`) or beside the screen that owns it, in that
  browser package's `ui/` folders. Nothing is shared between browser packages
  except through the design system, a contract, or a `<name>-client` package.

## File Organization

A browser package layers `model/` (pure) → `behavior/` (hooks, API bindings,
stores) → `ui/elements|blocks|sections` (ARCHITECTURE.md §3.4).

- `behavior/` for hooks
- `ui/elements/` and `ui/blocks/` for components (they never fetch)
- `ui/sections/` for a module's screens and the sections they compose
- `apps/ui/src/shell/` for the app's routing and chrome

## Hooks

- **Never return JSX from hooks.** Hooks manage state and logic; components render UI. A hook that returns JSX couples rendering to logic, hides the component tree, and makes both harder to test. Instead, return state/callbacks and let the consumer render the dialog/component explicitly.
- Use `.ts` for hooks, `.tsx` for components. If a hook file needs `.tsx`, that's a smell — the JSX should be in the consumer.

## Page headings

- **Page titles use `<PageLayout.Heading>` at its default size.** Never set a custom `size`/`fontSize` on a page title, and never hand-roll one with `<Text fontSize="lg">`. Consistent page titles are part of the design system, not a per-page decision. `PageLayout.Heading` omits `size`/`fontSize` from its props at the type level, so the typechecker rejects an override.
- A reusable component that renders its own title (for example the dataset editor) uses the Chakra `<Heading>` component at its default size, not a sized `<Text>`.
- `size` on a raw Chakra `<Heading>` is fine for _sub_-headings: drawer and dialog titles, card and section labels. The rule above is specifically about top-level page titles, not every heading on the page.
