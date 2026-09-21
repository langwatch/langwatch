import { Heading } from "@chakra-ui/react";
import { Drawer } from "~/components/ui/drawer";
import { useDrawer } from "~/hooks/useDrawer";
import { BlobStoreContent } from "./BlobStoreContent";

/**
 * The payload store as a drawer over the ops dashboard (URL-routed via
 * `drawer.open=opsBlobs`, so the old /ops/blobs links still land here).
 */
export function OpsBlobsDrawer() {
  const { closeDrawer } = useDrawer();
  return (
    <Drawer.Root
      open={true}
      placement="end"
      size="xl"
      onOpenChange={() => closeDrawer()}
    >
      <Drawer.Content bg="bg">
        <Drawer.Header>
          <Heading size="md">Payload store</Heading>
        </Drawer.Header>
        <Drawer.Body>
          <BlobStoreContent />
        </Drawer.Body>
        <Drawer.CloseTrigger />
      </Drawer.Content>
    </Drawer.Root>
  );
}
