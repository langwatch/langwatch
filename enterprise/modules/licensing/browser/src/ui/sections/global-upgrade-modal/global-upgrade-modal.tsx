import { useLent } from "@langwatch/browser-host/lent";
import { useUpgradeModalStore } from "@langwatch/browser-host/upgrade-modal-store";
import { Dialog } from "@langwatch/design-system/dialog";
import { Text } from "@langwatch/design-system/primitives";
import { SeatProrationPreviewToken } from "@langwatch/enterprise-billing-contract";
import { Suspense } from "react";

import { LimitContent } from "./limit-content.tsx";
import { LiteMemberRestrictionContent } from "./lite-member-restriction-content.tsx";

// Store-driven mount for the upgrade/limit dialog: plan limits, seat changes,
// unavailable features, mounted by licensing's host mount.
export function GlobalUpgradeModal({ isSaaS }: { isSaaS: boolean }) {
  const { isOpen, variant, close } = useUpgradeModalStore();
  const SeatProrationPreview = useLent(SeatProrationPreviewToken);
  if (!variant) return null;

  return (
    <Dialog.Root open={isOpen} onOpenChange={(event) => !event.open && close()}>
      <Dialog.Content bg="bg">
        <Dialog.CloseTrigger />
        {variant.mode === "limit" && (
          <LimitContent variant={variant} isSaaS={isSaaS} onClose={close} />
        )}
        {variant.mode === "seats" &&
          (SeatProrationPreview ? (
            <Suspense fallback={null}>
              <SeatProrationPreview variant={variant} open={isOpen} onClose={close} />
            </Suspense>
          ) : (
            <Dialog.Body>
              <Text>Seat management is not available in this deployment.</Text>
            </Dialog.Body>
          ))}
        {variant.mode === "liteMemberRestriction" && (
          <LiteMemberRestrictionContent onClose={close} />
        )}
      </Dialog.Content>
    </Dialog.Root>
  );
}
