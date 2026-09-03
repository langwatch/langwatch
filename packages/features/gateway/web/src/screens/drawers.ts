/**
 * The overlay this family owns, by the name the address uses.
 *
 * `gateway-routing-policies.screen.tsx` renders this same component inline off
 * its own `?policy=<id>` key, and that is not a duplicate registration: the
 * screen owns the address it opens from its own rows, and `?drawer.open=` is
 * how a link from ANOTHER page opens it. `gateway-virtual-key.screen.tsx` mints
 * exactly such a link — `/gateway/routing-policies?drawer.open=routingPolicy&drawer.policyId=<id>`
 * — for the policy a key routes through, and it opened nothing until this
 * export let the composing application register the name.
 *
 * The component takes `onClose` and does not close itself, which is what makes
 * it serve both callers: the screen passes the write that clears its own key,
 * and the registry adapter passes the navigator's `closeDrawer`.
 */

export { RoutingPolicyDrawer } from "../features/routing-policies/ui/sections/routing-policy-drawer";
