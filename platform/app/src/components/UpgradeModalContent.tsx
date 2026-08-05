import type { UpgradeModalVariant } from "../stores/upgradeModalStore";
import { Dialog } from "./ui/dialog";
import { LimitContent } from "./upgrade-modal/LimitContent";
import { LiteMemberRestrictionContent } from "./upgrade-modal/LiteMemberRestrictionContent";
import { SeatsContent } from "./upgrade-modal/SeatsContent";

interface UpgradeModalProps {
  open: boolean;
  onClose: () => void;
  variant: UpgradeModalVariant;
}

type VariantContentMap = {
  [K in UpgradeModalVariant["mode"]]: React.ComponentType<{
    variant: Extract<UpgradeModalVariant, { mode: K }>;
    onClose: () => void;
    open: boolean;
  }>;
};

export const MODAL_CONTENT: VariantContentMap = {
  limit: LimitContent,
  seats: SeatsContent,
  liteMemberRestriction: LiteMemberRestrictionContent,
};

export function UpgradeModal({ open, onClose, variant }: UpgradeModalProps) {
  // TS can't correlate variant.mode lookup with the matching variant type
  const Content = MODAL_CONTENT[variant.mode] as React.ComponentType<{
    variant: UpgradeModalVariant;
    onClose: () => void;
    open: boolean;
  }>;
  return (
    <Dialog.Root open={open} onOpenChange={(e) => !e.open && onClose()}>
      <Dialog.Content bg="bg">
        <Dialog.CloseTrigger />
        <Content variant={variant} onClose={onClose} open={open} />
      </Dialog.Content>
    </Dialog.Root>
  );
}
