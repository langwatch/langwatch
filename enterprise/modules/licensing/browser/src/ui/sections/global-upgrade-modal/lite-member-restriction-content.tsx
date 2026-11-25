import { Dialog } from "@langwatch/design-system/dialog";
import { RestrictedAccess } from "@langwatch/design-system/restricted-access";

export function LiteMemberRestrictionContent({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} title="Access required" cancelLabel={null}>
      <RestrictedAccess area="this feature" compact onBack={onClose} />
    </Dialog>
  );
}
