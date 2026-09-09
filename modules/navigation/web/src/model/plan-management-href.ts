/**
 * Where "upgrade" goes.
 *
 * SaaS manages a subscription; every other deployment manages a license. One
 * deployment fact, two addresses, and no third case — which is why it is a
 * function of the deployment reading the host already answers rather than a
 * port method of its own.
 *
 * It sits in `model` because two layers read it now: the shell's page body
 * draws the banner button with it, and the command bar's "View Plans" entry
 * resolves its path with it. A `ui/sections` module cannot be the definition
 * for something `behavior` asks — that is the direction `ui-web-layer-direction`
 * forbids — so the definition moved down and both layers read it here.
 */
export function planManagementHref(isSaaS: boolean): string {
  return isSaaS ? "/settings/subscription" : "/settings/license";
}
