---
paths:
  - "modules/*/browser/**"
  - "modules/*/client/**"
  - "enterprise/modules/*/browser/**"
  - "enterprise/modules/*/client/**"
  - "apps/ui/**"
  - "packages/design-system/**"
  - "packages/browser-host/**"
---

# Browser halves and UI

Load the `frontend` skill for module browser work and `design-system` for
component choice (`chakra-ui-*` only for raw Chakra v3). Authority:
`dev/docs/ARCHITECTURE.md` §10.

- **Layer order:** flat public entries → `model/` (pure) → `behavior/` (hooks,
  API bindings, stores) → `ui/elements|blocks|sections`. Elements and blocks
  can't fetch. A package that outgrows this nests `features/<name>/` repeating
  `model/behavior/ui`; a feature that is one component is a section.
- **Exports:** the target `exports` map is `./declaration` only. `surfaces/` and
  `screens/` are deleted spellings (§15) even where some still exist; don't add
  new ones. A capability the composition root needs goes through the
  declaration's `withCapabilities` slot.
- **Host access:** screens read session and navigation through a declared
  `*HostApi` implemented from `@langwatch/browser-host`, never the router
  directly. The tRPC client is derived from the contract, never hand-written.
- **Drawers** are URL-routed singletons with a navigation stack. A sub-flow
  navigates (`openDrawer("target", { onSuccess, onClose: goBack })`); never
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
- Render server errors from the handled payload (`readHandledError`) and the
  presentation registry, never `error.message`: since #5984 the tRPC wire message
  is the code slug. Map `meta.fieldErrors` onto form fields, not a toast.
