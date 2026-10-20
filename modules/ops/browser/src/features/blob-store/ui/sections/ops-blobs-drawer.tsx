import { Drawer } from "@langwatch/design-system/drawer";

import { BlobStoreContent } from "./blob-store-content.tsx";

/**
 * The payload store as a drawer over the ops dashboard. Addressed by the
 * dashboard screen's own `?payloadStore=open`, not the application drawer
 * registry - a composition a feature-web package may not carry a copy of.
 */
export function OpsBlobsDrawer({ onClose }: { onClose: () => void }) {
  return (
    <Drawer onClose={onClose} size="xl" title="Payload store">
      <BlobStoreContent />
    </Drawer>
  );
}
