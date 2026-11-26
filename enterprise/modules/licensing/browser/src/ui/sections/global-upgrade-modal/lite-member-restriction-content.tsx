import { Lent } from "@langwatch/browser-host/lent";
import { Dialog } from "@langwatch/design-system/dialog";
import { RestrictedAccess } from "@langwatch/design-system/restricted-access";
import { RequestAccessToken } from "@langwatch/organization-client";

import { liteMemberRequestReason } from "../../../model/lite-member-request-reason.ts";

export function LiteMemberRestrictionContent({
  open,
  onClose,
  resource,
}: {
  open: boolean;
  onClose: () => void;
  /** The permission resource the Lite seat was refused, as the server named it. */
  resource?: string;
}) {
  return (
    <Dialog open={open} onClose={onClose} title="Access required" cancelLabel={null}>
      <RestrictedAccess
        area="this feature"
        compact
        onBack={onClose}
        requestAction={
          <Lent of={RequestAccessToken} props={{ reason: liteMemberRequestReason(resource) }} />
        }
      />
    </Dialog>
  );
}
