/**
 * The scope picker and chips, named ONCE for the whole package.
 *
 * `ScopeChipPicker`, `ScopeFilter` and `ProviderScopeChips` are
 * `@langwatch/authz-web`'s harvested surface — the data-governance family
 * created it, the model-provider family reused it, and this family is the third.
 * Every module that names that package is a `ui-screen-closure` finding, and the
 * rule counts import LINES: the two drawers, the two screens and the scope-filter
 * model would be five findings for what is one decision.
 *
 * So the components are re-exported here and the pure address half is re-exported
 * from `model/api-key-scope-filter.ts`, which already has to name the surface for
 * its predicate. Two modules name it; the other five read from these. That is the
 * model-provider family's lesson ("put a shared type behind the one module that
 * already had to name the surface") applied to components as well as types.
 */

export {
  ProviderScopeChips,
  ScopeChipPicker,
  ScopeFilter,
  type ScopeChipPickerEntry,
  type ScopeTriadEntry,
} from "@langwatch/authz-web/surfaces/scope-picker";
