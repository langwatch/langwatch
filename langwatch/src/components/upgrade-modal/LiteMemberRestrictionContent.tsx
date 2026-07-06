import { Button, Text, VStack } from "@chakra-ui/react";
import { ShieldX } from "lucide-react";
import type { UpgradeModalVariant } from "../../stores/upgradeModalStore";
import { Dialog } from "../ui/dialog";

export function LiteMemberRestrictionContent({
  onClose,
}: {
  variant: Extract<UpgradeModalVariant, { mode: "liteMemberRestriction" }>;
  onClose: () => void;
}) {
  return (
    <>
      <Dialog.Header>
        <ShieldX />
        <Dialog.Title>Feature Not Available</Dialog.Title>
      </Dialog.Header>
      <Dialog.Body>
        <VStack gap={4} align="start">
          <Text>
            This feature is not available for your current role. Contact your
            organization admin for access.
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
