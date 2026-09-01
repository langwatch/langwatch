# React/Next.js

## Page vs Component Separation

- **Pages**: routing, permissions (`src/pages/`)
- **Components**: UI logic (`src/*/components/*.layout.tsx`)

## File Organization

- `hooks/` for hooks
- `components/` for components
- `pages/` for pages

## Hooks

- **Never return JSX from hooks.** Hooks manage state and logic; components render UI. A hook that returns JSX couples rendering to logic, hides the component tree, and makes both harder to test. Instead, return state/callbacks and let the consumer render the dialog/component explicitly.
- Use `.ts` for hooks, `.tsx` for components. If a hook file needs `.tsx`, that's a smell — the JSX should be in the consumer.

## Page headings

- **Page titles use `<PageLayout.Heading>` at its default size.** Never set a custom `size`/`fontSize` on a page title, and never hand-roll one with `<Text fontSize="lg">`. Consistent page titles are part of the design system, not a per-page decision. `PageLayout.Heading` omits `size`/`fontSize` from its props at the type level, so the typechecker rejects an override.
- A reusable component that renders its own title (for example the dataset editor) uses the Chakra `<Heading>` component at its default size, not a sized `<Text>`.
- `size` on a raw Chakra `<Heading>` is fine for *sub*-headings: drawer and dialog titles, card and section labels. The rule above is specifically about top-level page titles, not every heading on the page.
