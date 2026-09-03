import { EventSourcingLayout } from "../../ui/sections/event-sourcing-layout";
import { BlobStoreContent } from "../../features/blob-store/ui/sections/blob-store-content";

/**
 * The payload store, as a section of the event-sourcing workspace.
 *
 * It was a top-level Ops entry, then a redirect onto a drawer over the ops
 * dashboard. Neither placement said what it is: the offloaded bodies of
 * event-sourcing payloads, read by the same operator working through the
 * sections beside it. This address is a page again so the workspace rail stays
 * on screen and the entry can be active, and the dashboard keeps its own drawer
 * shortcut for the operator who is already there.
 */
export default function OpsPayloadStoreScreen() {
  return (
    <EventSourcingLayout pageTitle="Payload store">
      <BlobStoreContent />
    </EventSourcingLayout>
  );
}
