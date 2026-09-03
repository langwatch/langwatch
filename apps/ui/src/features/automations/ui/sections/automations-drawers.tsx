/**
 * The automation authoring drawer, mounted in the host its package asks for.
 *
 * TWO WAYS IN, ONE COMPONENT, AND THEY DO NOT COLLIDE. The automations screen
 * renders this same editor inline off its own `?automation=<id>` key, which is
 * how a reader opens it from a row on the page that owns those rows. This
 * registration answers every caller that is not that page: the alert emails,
 * whose "Edit automation" link is
 * `…/automations?drawer.open=automation&drawer.automationId=<id>&drawer.source=email-link`,
 * the trace explorer's Automate button, the command palette, and Langy's relay
 * links. Nothing mints both keys, and each write replaces the whole query
 * string, so a URL opens exactly one editor.
 *
 * THE EMAIL LINK IS WHY THIS ONE MATTERS MOST. It is minted into a message that
 * has already left the product, so it cannot be corrected afterwards: a name
 * that does not resolve turns every alert we have ever sent into a link that
 * lands on the list with nothing open. That is what registering the name here
 * fixes, on the receiving side, without touching a template.
 *
 * The component does not close itself — the drawers doc's rule, since a target
 * that calls `closeDrawer` clears the caller's stack too — so the close is
 * passed in, and here that is the navigator's own.
 */

import { AutomationDrawer as Automation } from "@langwatch/automation-web/drawers";
import { useDrawer } from "@langwatch/ui-drawer";

import { withAutomationsHost } from "./automations-host-provider";

/**
 * What the address can carry, as the editor names it.
 *
 * `source` is the marker the email link sets, and the drawer reads it to draw
 * a one-line landing banner for a reader who arrived from an inbox.
 */
type AutomationAddress = {
  automationId?: string;
  source?: string;
  prefilledGraphId?: string;
  prefilledSeriesName?: string;
  initialSource?: string;
  initialName?: string;
  initialAction?: string;
  initialFilters?: string;
  initialFilterQuery?: string;
};

function AutomationFromAddress(address: AutomationAddress) {
  const { closeDrawer } = useDrawer();

  return <Automation {...address} onClose={closeDrawer} />;
}

export const AutomationDrawer = withAutomationsHost(AutomationFromAddress);
