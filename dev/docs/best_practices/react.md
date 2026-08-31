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

## Avatars

- **Import the avatar from `~/components/ui/avatar`, never from `@chakra-ui/react`.** Chakra derives initials with `name.charAt(0)` on the first and last word, which returns half of any character outside the basic plane — so a project named "🚩 Langy", a suite named with an emoji, or an SSO display name that starts with one painted a replacement box. Our wrapper derives the initials in grapheme clusters and passes them down as children, so Chakra's helper is never reached. Everything else (`Avatar.Root`, `Avatar.Image`, `Avatar.Icon`, the types) is re-exported unchanged, so the import is the whole difference. `src/components/ui/__tests__/avatarImportGuard.unit.test.ts` enforces it.
- **A caller that wants one specific character passes it as children**, not as `name`: `<Avatar.Fallback>{firstGrapheme(project.name)}</Avatar.Fallback>`. `name` means "derive initials from this", and for a project or a suite one character is the design, not two.
- **Taking the first character of anything a customer typed goes through `firstGrapheme`** (`~/utils/firstGrapheme`), avatar or not. `charAt(0)` and `slice(0, 1)` cut emoji in half; `Intl.Segmenter` also keeps a flag, a ZWJ family or a skin-toned emoji together, which iterating code points alone would not.
