/**
 * Re-export scope components once so the rest of the package doesn't hit
 * ui-screen-closure findings on each import of authz-web.
 */

export { ProviderScopeChips } from "../sections/authz/scope-picker/provider-scope-chips.tsx";
export {
  ScopeChipPicker,
  type ScopeChipPickerEntry,
  type ScopeTriadEntry,
} from "../sections/authz/scope-picker/scope-chip-picker.tsx";
export { ScopeFilter } from "../sections/authz/scope-picker/scope-filter.tsx";
