/**
 * The two automation overlays, mounted in the host their package asks for.
 *
 * ONE WAY IN, FOR EVERY CALLER. The automations screen used to render the
 * editor inline off a `?automation=<id>` key of its own, so the same editor had
 * two addresses and only the registry one survived being pasted onto another
 * page. The screen names the drawer now and its host writes `?drawer.open=`,
 * which puts its rows on exactly the address the alert emails, the REST
 * `platformUrl`, the trace explorer's Automate button, the command palette and
 * Langy's relay links already mint.
 *
 * `viewAutomation` is registered here for the same reason: the viewer hands
 * over to the editor, and two overlays that hand over to each other cannot be
 * on two different mechanisms — the hand-over would have to clear one address
 * and write the other, which is the bug the single mechanism removes.
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

import {
  AutomationDrawer as Automation,
  ViewAutomationDrawer as ViewAutomation,
} from "@langwatch/automation-web/drawers";
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

/**
 * The read-only panel, and the one hand-over it makes.
 *
 * "Edit" leaves for the authoring drawer, which is a drawer NAVIGATING to
 * another drawer rather than mounting one — `openDrawer` pushes onto the stack
 * and clears the viewer's own parameters, so the editor cannot open carrying
 * the id under the viewer's key.
 *
 * An address that names no automation renders nothing: there is no automation
 * to show, and asking the server for an empty id would spend a round trip to
 * be told so. Nothing in the product mints such a link — the screen, the
 * viewer's own hand-over and every outbound link all carry an id.
 */
function ViewAutomationFromAddress({ automationId }: { automationId?: string }) {
  const { closeDrawer, openDrawer } = useDrawer();

  if (!automationId) return null;

  return (
    <ViewAutomation
      automationId={automationId}
      onClose={closeDrawer}
      onEdit={(id) => openDrawer("automation", { automationId: id })}
    />
  );
}

export const ViewAutomationDrawer = withAutomationsHost(ViewAutomationFromAddress);
