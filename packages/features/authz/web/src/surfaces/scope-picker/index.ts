/**
 * Scope selection, as a narrow contribution.
 *
 * The picker and the read-only chips travel together because the picker
 * renders the chips: splitting them into two surfaces would make one surface
 * import another, which ADR-004 forbids and which would be the wrong shape
 * anyway — a caller that offers scope selection always shows what is selected.
 *
 * Harvested from `platform/app/src/components/settings/{ScopeChipPicker,ProviderScopeChips}.tsx`
 * with the platform seams substituted: `SmallLabel` now comes from the Design
 * System, and the chip's optional link is a plain Chakra anchor rather than the
 * router-aware `~/components/ui/link` — a surface may not navigate, and every
 * href these chips carry is an in-app address the browser can follow on its own.
 * The platform copies stay for the settings screens that still consume them.
 *
 * `ScopeFilter` joined them with the data-governance move: it is the read-side
 * twin — which scope the page is LOOKING at rather than which scopes a rule is
 * written to — and every page that offers one offers the other. Its pure half
 * (the `?scope=` address and the row predicate) travels beside it so two
 * packages share one reading of the URL contract instead of two.
 */

export {
  isScopeInFilter,
  resolveScopeFilter,
  scopeFilterAddressWrite,
  scopeFilterFromAddress,
  scopeHierarchyOf,
  type ResolvedScopeFilter,
  type ScopeFilterAddressWrite,
  type ScopeHierarchy,
} from "./scope-filter-address";
export { ScopeFilter, type AvailableScopes, type ScopeFilterValue } from "./scope-filter";
export {
  ProviderScopeChips,
  scopeChipTooltip,
  type ProviderScopeType,
} from "./provider-scope-chips";
export {
  collapseRedundantScopes,
  DEFAULT_SCOPE_TYPES,
  ScopeChipPicker,
  type ScopeChipPickerEntry,
  type ScopeChipPickerScopeType,
  type ScopeTriadEntry,
  type ScopeTriadType,
} from "./scope-chip-picker";
