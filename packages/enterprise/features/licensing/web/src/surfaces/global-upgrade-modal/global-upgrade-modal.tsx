import { Text } from "@chakra-ui/react";
import { Dialog } from "@langwatch/design-system/dialog";
import { UiSlot } from "@langwatch/ui-host/slots";
import { useUpgradeModalStore } from "@langwatch/ui-host/upgrade-modal-store";
import { LimitContent } from "./limit-content.tsx";
import { LiteMemberRestrictionContent } from "./lite-member-restriction-content.tsx";

/**
 * Store-driven mount for the upgrade/limit dialog. One dialog, three things a
 * customer can be stopped by: a plan limit, a seat change waiting to be
 * confirmed, and a feature their seat does not open.
 *
 * The seat body is a SLOT rather than a component here: what a seat change
 * costs is priced by whoever bills the account, and licensing does not bill.
 * A deployment with no billing fills nothing and reads the fallback.
 * specs/licensing/proration-preview.feature.
 */
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
