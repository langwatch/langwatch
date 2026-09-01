import { EventSourcingLayout } from "../../ui/sections/event-sourcing-layout";
import { DejaViewContent } from "../../features/deja-view/ui/sections/deja-view-panel";

/**
 * Deja View, as a section of the event-sourcing workspace.
 *
 * It reads the event log an aggregate at a time — the same substrate every
 * other section here reports on — so it belongs beside them rather than as its
 * own top-level Ops entry. `EventSourcingLayout` replaces the bare page shell so
 * the workspace rail stays on screen.
 */
export default function OpsDejaViewScreen() {
  return (
    <EventSourcingLayout pageTitle="Deja View">
      <DejaViewContent />
    </EventSourcingLayout>
  );
}
