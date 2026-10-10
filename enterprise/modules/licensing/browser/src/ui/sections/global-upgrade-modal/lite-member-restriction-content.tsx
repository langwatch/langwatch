import { Dialog } from "@langwatch/design-system/dialog";
import { RestrictedAccess } from "@langwatch/design-system/restricted-access";

export function LiteMemberRestrictionContent({ onClose }: { onClose: () => void }) {
  return (
    <>
      <Dialog.Header>
        <Dialog.Title>Access required</Dialog.Title>
      </Dialog.Header>
      <Dialog.Body>
        <RestrictedAccess area="this feature" compact onBack={onClose} />
      </Dialog.Body>
    </>
  );
}
