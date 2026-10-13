import { useLent } from "@langwatch/browser-host/lent";
import { Dialog } from "@langwatch/design-system/dialog";
import { Text } from "@langwatch/design-system/primitives";
import { SeatProrationPreviewToken } from "@langwatch/enterprise-billing-client";
import { Suspense } from "react";

import { useUpgradeModalStore } from "../../../model/upgrade-modal-store.ts";
import { LimitContent } from "./limit-content.tsx";
import { LiteMemberRestrictionContent } from "./lite-member-restriction-content.tsx";

// Store-driven mount for the upgrade/limit dialog: plan limits, seat changes,
// unavailable features, mounted by licensing's host mount.
export function GlobalUpgradeModal({ isSaaS }: { isSaaS: boolean }) {
  const { isOpen, variant, close } = useUpgradeModalStore();
  const SeatProrationPreview = useLent(SeatProrationPreviewToken);
  if (!variant) return null;

  if (variant.mode === "limit") {
    return <LimitContent open={isOpen} variant={variant} isSaaS={isSaaS} onClose={close} />;
  }
  if (variant.mode === "liteMemberRestriction") {
    return <LiteMemberRestrictionContent open={isOpen} onClose={close} />;
  }
  if (SeatProrationPreview) {
    return (
      <Suspense fallback={null}>
        <SeatProrationPreview variant={variant} open={isOpen} onClose={close} />
      </Suspense>
    );
  }
  return (
    <Dialog open={isOpen} onClose={close} title="Seat management" cancelLabel={null}>
      <Text>Seat management is not available in this deployment.</Text>
    </Dialog>
  );
}
