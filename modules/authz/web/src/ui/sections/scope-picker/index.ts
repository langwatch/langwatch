// Scope selection surface; picker and chips together; pure filter half travels.

export {
  isScopeInFilter,
  resolveScopeFilter,
  scopeFilterAddressWrite,
  scopeFilterFromAddress,
  scopeHierarchyOf,
  type ResolvedScopeFilter,
  type ScopeFilterAddressWrite,
  type ScopeHierarchy,
} from "./scope-filter-address.ts";
export { ScopeFilter, type AvailableScopes, type ScopeFilterValue } from "./scope-filter.tsx";
export {
  ProviderScopeChips,
  scopeChipTooltip,
  type ProviderScopeType,
} from "./provider-scope-chips.tsx";
export {
  collapseRedundantScopes,
  DEFAULT_SCOPE_TYPES,
  ScopeChipPicker,
  type ScopeChipPickerEntry,
  type ScopeChipPickerScopeType,
  type ScopeTriadEntry,
  type ScopeTriadType,
} from "./scope-chip-picker.tsx";
