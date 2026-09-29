import { Drawer } from "@langwatch/design-system/drawer";

import { BlobStoreContent } from "./blob-store-content.tsx";

/**
 * The payload store as a drawer over the ops dashboard. Addressed by the
 * dashboard screen's own `?payloadStore=open`, not the application drawer
 * registry - a composition a feature-web package may not carry a copy of.
 */
export function OpsBlobsDrawer({ onClose }: { onClose: () => void }) {
  return (
    <Drawer.Root open={true} placement="end" size="xl" onOpenChange={() => onClose()}>
      <Drawer.Content bg="bg">
        <Drawer.Header>
          <Drawer.Title>Payload store</Drawer.Title>
        </Drawer.Header>
        <Drawer.Body>
          <BlobStoreContent />
        </Drawer.Body>
        <Drawer.CloseTrigger />
      </Drawer.Content>
    </Drawer.Root>
  );
}
