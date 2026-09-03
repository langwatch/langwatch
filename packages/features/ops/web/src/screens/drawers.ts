/**
 * The overlay this family owns, by the name the address uses.
 *
 * The Foundry is a PAGE and a DRAWER over the same playground: `/ops/foundry`
 * gives an operator the whole surface, and `?drawer.open=foundry` — which is
 * what the command palette writes, from two entries — puts it beside whatever
 * they are already reading. The command entry opened nothing until this export
 * let the composing application register the name.
 *
 * `FoundryTransport` IS PUBLISHED ALONGSIDE IT, and that is the point of a
 * second entry rather than a component export off the root. The drawer reads
 * the project it sends a generated trace as, and its API key, through
 * `FoundryRuntimeProvider`; the page mounts that provider for itself, so a
 * drawer mounted anywhere else has to bring its own. The root barrel publishes
 * the drawer but not the provider, which would leave the registry able to name
 * a component it cannot mount.
 */

export { FoundryDrawer } from "../features/foundry/ui/sections/foundry-drawer";
export { FoundryTransport } from "../features/foundry/ui/sections/foundry-transport";
