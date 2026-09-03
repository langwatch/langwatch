/**
 * The overlay this family owns, by the name the address uses.
 *
 * ONE EDITOR, ONE ADDRESS. `gateway-routing-policies.screen.tsx` kept a
 * `?policy=<id>` key of its own and rendered this component inline, on the
 * reading that the drawer registry is composition a feature-web package may not
 * reach. That is true of the registry and false of its ADDRESS, which is a
 * query string the host already writes — so the screen names the drawer now and
 * the same editor answers every caller at one link.
 *
 * The caller that made it matter is `gateway-virtual-key.screen.tsx`, which
 * links to `/gateway/routing-policies?drawer.open=routingPolicy&drawer.policyId=<id>`
 * for the policy a key routes through. That link opened nothing until this
 * export let the composing application register the name; the policies table's
 * own rows wrote a second address that only that page understood.
 *
 * The component takes `onClose` and does not close itself, which is the drawers
 * doc's rule: a target that calls `closeDrawer` clears the caller's stack with
 * it. The registry adapter passes the navigator's own close.
 */

export { RoutingPolicyDrawer } from "../features/routing-policies/ui/sections/routing-policy-drawer";
