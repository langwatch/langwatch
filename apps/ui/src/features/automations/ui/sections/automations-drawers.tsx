/**
 * The two automation overlays, mounted in the host their package asks for.
 * One address for every caller — alert emails, REST, the trace explorer and
 * Langy all mint the same `?drawer.open=automation`.
 */

import {
  AutomationDrawer as Automation,
  ViewAutomationDrawer as ViewAutomation,
} from "@langwatch/automation-web/drawers";
import { useDrawer } from "@langwatch/ui-drawer";

import { withHost } from "../../../../ui/sections/ui-page";
import { AutomationsHost } from "./automations-host";

/** What the address can carry. `source` is the email link's marker, read to draw a one-line "arrived from an inbox" banner. */
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

export const AutomationDrawer = withHost(AutomationsHost, AutomationFromAddress);

/**
 * The read-only panel. "Edit" navigates to the authoring drawer via
 * `openDrawer` rather than mounting one, clearing the viewer's own params.
 * No `automationId` renders nothing rather than a round trip for an empty id.
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

export const ViewAutomationDrawer = withHost(AutomationsHost, ViewAutomationFromAddress);
