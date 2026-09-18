import { Text } from "@chakra-ui/react";
import { UiSlot } from "@langwatch/browser-host/slots";
import { useUpgradeModalStore } from "@langwatch/browser-host/upgrade-modal-store";
import { Dialog } from "@langwatch/design-system/dialog";

import { LimitContent } from "./limit-content.tsx";
import { LiteMemberRestrictionContent } from "./lite-member-restriction-content.tsx";

// Store-driven mount for the upgrade/limit dialog: plan limits, seat changes,
// unavailable features. Seat content is a SLOT, not a component.
export function GlobalUpgradeModal({ isSaaS }: { isSaaS: boolean }) {
  const { isOpen, variant, close } = useUpgradeModalStore();
  if (!variant) return null;

  return (
    <Dialog.Root open={isOpen} onOpenChange={(event) => !event.open && close()}>
      <Dialog.Content bg="bg">
        <Dialog.CloseTrigger />
        {variant.mode === "limit" && (
          <LimitContent variant={variant} isSaaS={isSaaS} onClose={close} />
        )}
        {variant.mode === "seats" && (
          <UiSlot
            name="seatProrationPreview"
            props={{ variant, open: isOpen, onClose: close }}
            fallback={
              <Dialog.Body>
                <Text>Seat management is not available in this deployment.</Text>
              </Dialog.Body>
            }
          />
        )}
        {variant.mode === "liteMemberRestriction" && (
          <LiteMemberRestrictionContent onClose={close} />
        )}
      </Dialog.Content>
    </Dialog.Root>
  );
}
