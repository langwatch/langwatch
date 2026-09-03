/**
 * The two overlays this family owns, by the names the address uses.
 *
 * ONE MECHANISM, NOT TWO. `automations.screen.tsx` used to render both of these
 * inline off query keys of its own — `?automation=<id>` and
 * `?viewAutomation=<id>` — because the drawer registry is composition a
 * feature-web package may not reach. It still may not reach it, and it does not
 * have to: the registry is addressed by a query string, and the host writes
 * query strings. So the screen names a drawer, the host spells
 * `?drawer.open=<name>`, and the same editor has ONE address whichever way in
 * the reader took (`dev/docs/best_practices/drawers.md`).
 *
 * That mattered because the other ways in were never the screen's. Every alert
 * email carries `…/automations?drawer.open=automation&drawer.automationId=<id>&drawer.source=email-link`
 * as `trigger.editUrl` (`templating/template-context.ts`), the REST API hands
 * out the same shape as `platformUrl`, and so do the trace explorer's Automate
 * button, the command palette and Langy's relay links. None of them opened
 * anything until this export let the composing application register the name.
 *
 * Neither component closes itself, which is what lets one component serve every
 * caller: the drawers doc's rule is that a target calling `closeDrawer` clears
 * the caller's stack too, so the close arrives as a prop and the registry
 * adapter passes the navigator's own.
 */

export { AutomationDrawer } from "../features/authoring/ui/sections/automation-drawer";
export { ViewAutomationDrawer } from "../features/authoring/ui/sections/view-automation-drawer";
