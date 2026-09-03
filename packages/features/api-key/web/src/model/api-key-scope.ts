/**
 * A scope an API key is bound to, as this package speaks of it.
 *
 * Structurally identical to `ScopeTriadEntry` from
 * `@langwatch/authz-web/surfaces/scope-picker`, and deliberately not imported
 * from it: `ui-screen-closure` counts IMPORT LINES, and every module in this
 * package that touched a scope naming that surface would be a finding apiece.
 * The screens and drawers that actually RENDER the picker name it once; every
 * other module speaks this shape, and the two are checked against each other by
 * `api-key-scope.unit.test.ts` assigning one to the other. The model-provider
 * family's lesson applied to a value type rather than to a component.
 */

/** The three scope kinds an API key role binding can sit at. */
export type ApiKeyScopeType = "ORGANIZATION" | "TEAM" | "PROJECT";

/** One scope on a key, as it is selected and as it is sent. */
export interface ApiKeyScopeSelection {
  scopeType: ApiKeyScopeType;
  scopeId: string;
}
