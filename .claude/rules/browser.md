---
paths:
  - "modules/*/browser/**"
  - "modules/*/client/**"
  - "enterprise/modules/*/browser/**"
  - "enterprise/modules/*/client/**"
  - "apps/ui/**"
  - "packages/design-system/**"
  - "packages/browser-host/**"
  - "packages/browser/**"
  - "packages/error-views/**"
  - "packages/react-rum/**"
---

# Browser halves and UI

Load the `frontend` skill for module browser work and `design-system` for
component choice (`chakra-ui-*` only for raw Chakra v3). Authority:
`dev/docs/ARCHITECTURE.md` §10.

- **No hand memoisation.** The React Compiler (Oxc, `apps/ui/vite.config.ts`)
  memoises every component and hook it can compile. Don't write `useMemo`,
  `useCallback` or `React.memo`; delete them when you touch a file. A component it
  skips (reads a ref during render, an `eslint-disable` of a hooks rule) is
  logged by the dev server: fix the cause rather than memoising by hand.
- **The design system is the source of truth for components.** Every banner or
  alert, dialog, drawer, empty state, menu, picker and table comes from
  `@langwatch/design-system`; never hand-roll one in a module (a tinted, bordered
  box with an icon is a hand-rolled alert). A missing need is added to the design
  system first, with a story. Look in `packages/design-system/src/components/<concern>/`
  (or `/design-system` on the dev server). `Drawer`, `Dialog` and `Card` are callable
  shapes with closed props (ADR-002, `packages/design-system/adrs/002-overlay-and-card-shapes.md`;
  props and scales in `.claude/skills/design-system/references/component-apis.md`): write
  `<Drawer title onClose footer>`, never new `Drawer.Root`/`Dialog.Root`/`Card.Root` part
  assembly in a module. Those parts are legacy, being removed. Internal consoles
  (`packages/design-system-internal`) and mail (`packages/mail`) are separate design languages
  with their own boundaries, not product Chakra.
- **Layer order:** flat public entries → `model/` (pure) → `behavior/` (hooks,
  API bindings, stores) → `ui/elements|blocks|sections`. Elements and blocks
  can't fetch. A package that outgrows this nests `features/<name>/` repeating
  `model/behavior/ui`; a feature that is one component is a section.
- **Exports:** every browser package exports `./declaration` only (landed and
  enforced). `surfaces/` and `screens/` are deleted spellings (§15); don't add them. A capability the composition root needs goes through the
  declaration's `withCapabilities` slot.
- **Host access:** screens read session and navigation through a declared
  `*HostApi` implemented from `@langwatch/browser-host`, never the router
  directly. A service the owner provides comes through `.provides(Service, { load })`
  and `useHostService` (§10.1, `modules/feature-flag/browser`). The tRPC client is derived
  from the contract, never hand-written; existing `BorrowedProcedures` or large handwritten
  maps are debt, so add the procedure to the owner's contract and client instead.
- **Drawers** are URL-routed singletons with a navigation stack. A sub-flow
  navigates (`openDrawer(Token, { onSuccess, onClose: goBack })`, the owner's
  drawer token, §10.1); never
  mount a drawer inside another drawer.
- **No kits** (§3.4): code repeated within a module stays there; across modules it
  goes to the design system (props or a query result, never fetches), pure domain
  logic to the owner's contract, framework hooks to `browser-host`. Data comes
  from each module's `<name>-client`; client state lives in the one global UI
  store, namespaced per module (§10.2).
- **Frontend boundary:** no value-import chain from server code may reach a
  browser-only package, and no browser module value-imports server-shaped
  declarations. `import type` is always fine.
- Before a non-trivial UI change read the matching docs in
  `dev/docs/best_practices/` (`react.md`, `list-table.md`,
  `scope-selector-and-badges.md`, `row-actions-overflow-menu.md`,
  `selection-action-bar.md`, `scoped-resources.md`) and extend the existing
  pattern.
- Scope selection always uses `ScopeChipPicker`, never a hand-rolled Select.
- Copy follows `dev/docs/best_practices/copywriting.md`: say what it does for
  the customer, not how it's built; spell words out ("tokens", not "tok").
- In a child component that receives `form`, use
  `useWatch({ control: form.control, name })`; `form.watch()` doesn't re-render
  children.
- Reusable error views are `@langwatch/error-views`; browser errors and navigation spans are
  `@langwatch/react-rum` (§10.2).
- Render server errors from the handled payload (`readHandledError`) and the
  presentation registry, never `error.message`: since #5984 the tRPC wire message
  is the code slug. Map `meta.fieldErrors` onto form fields, not a toast.
