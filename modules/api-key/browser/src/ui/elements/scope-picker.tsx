/**
 * Re-export scope components once so the rest of the package doesn't hit
 * ui-screen-closure findings on each import of authz-web.
 */

export {
  ProviderScopeChips,
  ScopeChipPicker,
  ScopeFilter,
  type ScopeChipPickerEntry,
  type ScopeTriadEntry,
} from "@langwatch/authz-browser-kit";
