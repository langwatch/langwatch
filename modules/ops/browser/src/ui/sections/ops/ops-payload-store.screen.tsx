import { BlobStoreContent } from "../../../features/blob-store/ui/sections/blob-store-content.tsx";
import { EventSourcingLayout } from "../../../ui/sections/event-sourcing-layout.tsx";

/** Payload store in event-sourcing workspace; keeps workspace rail on screen. */
export default function OpsPayloadStoreScreen() {
  return (
    <EventSourcingLayout pageTitle="Payload store">
      <BlobStoreContent />
    </EventSourcingLayout>
  );
}
