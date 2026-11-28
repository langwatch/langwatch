import { Lent } from "@langwatch/browser-host/lent";
import { Dialog } from "@langwatch/design-system/dialog";
import { RestrictedAccess } from "@langwatch/design-system/restricted-access";
import { RequestAccessToken } from "@langwatch/organization-client";

import { liteMemberRequestReason } from "../../../model/lite-member-request-reason.ts";

export function LiteMemberRestrictionContent({
  open,
  onClose,
  resource,
  permission,
}: {
  open: boolean;
  onClose: () => void;
  /** The permission resource the Lite seat was refused, as the server named it. */
  resource?: string;
  /** The permission refused; Request access draws nothing where a full seat would not lift it. */
  permission?: string;
}) {
  return (
    <Dialog open={open} onClose={onClose} title="Access required" cancelLabel={null}>
      <RestrictedAccess
        area="this feature"
        compact
        onBack={onClose}
        requestAction={
          <Lent
            of={RequestAccessToken}
            props={{
              reason: liteMemberRequestReason(resource),
              ...(permission === undefined ? {} : { permission }),
            }}
          />
        }
      />
    </Dialog>
  );
}
