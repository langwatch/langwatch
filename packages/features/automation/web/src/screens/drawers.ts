/**
 * The overlay this family owns, by the name the address uses.
 *
 * `automations.screen.tsx` renders this same component inline off its own
 * `?automation=<id>` key, and that is not a duplicate registration: the screen
 * owns the address it opens from its own rows, and `?drawer.open=` is how a
 * link from OUTSIDE the application opens it. Every alert email carries such a
 * link — `templating/template-context.ts` mints
 * `…/automations?drawer.open=automation&drawer.automationId=<id>&drawer.source=email-link`
 * as `trigger.editUrl` — and so do the trace explorer's Automate button, the
 * command palette and Langy's relay links. None of them opened anything until
 * this export let the composing application register the name.
 *
 * The two keys cannot both be set by anything that mints one, so a URL opens
 * exactly one editor. The component takes `onClose` and does not close itself,
 * which is what lets the screen pass the write that clears its own key while
 * the registry adapter passes the navigator's `closeDrawer`.
 */

export { AutomationDrawer } from "../features/authoring/ui/sections/automation-drawer";
