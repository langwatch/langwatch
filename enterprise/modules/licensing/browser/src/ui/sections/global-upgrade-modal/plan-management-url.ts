/**
 * Where "upgrade" goes. A family-local copy of billing-web's pure
 * `planManagementUrl` — kept local since billing-web already depends on
 * licensing-web and the reverse edge would cycle.
 */
export function planManagementUrl(isSaaS: boolean): string {
  return isSaaS ? "/settings/subscription" : "/settings/license";
}
