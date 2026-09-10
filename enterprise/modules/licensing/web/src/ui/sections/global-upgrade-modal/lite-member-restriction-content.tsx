import { Button, Text, VStack } from "@chakra-ui/react";
import { Dialog } from "@langwatch/design-system/dialog";
import { ShieldX } from "lucide-react";

/**
 * What a lite member is told when they reach something their seat does not
 * open. It is a role limit, not a plan limit, so the way out is their own
 * admin rather than a bigger plan — and the words say exactly that.
 */
export function LiteMemberRestrictionContent({ onClose }: { onClose: () => void }) {
  return (
    <>
      <Dialog.Header>
        <ShieldX />
        <Dialog.Title>Feature Not Available</Dialog.Title>
      </Dialog.Header>
      <Dialog.Body>
        <VStack gap={4} align="start">
          <Text>
            This feature is not available for your current role. Contact your organization admin for
            access.
          </Text>
        </VStack>
      </Dialog.Body>
      <Dialog.Footer>
        <Button colorPalette="blue" onClick={onClose}>
          Dismiss
        </Button>
      </Dialog.Footer>
    </>
  );
}
