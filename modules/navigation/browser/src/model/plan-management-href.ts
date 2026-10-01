/** Upgrade link; SaaS→subscription, else license; in model since both shell and behavior read it */
export function planManagementHref(isSaaS: boolean): string {
  return isSaaS ? "/settings/subscription" : "/settings/license";
}
