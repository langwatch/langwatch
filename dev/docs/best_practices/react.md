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
