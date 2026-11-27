import { Checkbox } from "@langwatch/design-system/checkbox";
import { ConfirmDialog } from "@langwatch/design-system/confirm-dialog";
import { Box, Text } from "@langwatch/design-system/primitives";
import { useEffect, useState } from "react";

import { api } from "../../behavior/organization-api.ts";
import { removeButtonLabel, seatRemovalCopy } from "../../model/seat-removal-copy.ts";

/**
 * Confirms removing a member and says what happens to their seat; when it frees at once and
 * somebody waits, offers it to them (specs/licensing/seat-rotation.feature).
 */
export function RemoveMemberDialog({
  organizationId,
  organizationName,
  target,
  loading,
  onClose,
  onConfirm,
}: {
  organizationId: string;
  organizationName: string | undefined;
  /** The member being removed; `null` keeps the dialog closed. */
  target: { userId: string; label: string } | null;
  loading: boolean;
  onClose: () => void;
  onConfirm: (input: { userId: string; giveSeatToUserId: string | null }) => void;
}) {
  const preview = api.organization.getSeatRemovalPreview.useQuery(
    { organizationId, userId: target?.userId ?? "" },
    { enabled: !!target, retry: false },
  );
  const copy = seatRemovalCopy(preview.isSuccess ? preview.data : null);
  const [giveSeat, setGiveSeat] = useState(true);
  useEffect(() => setGiveSeat(true), [target?.userId]);

  return (
    <ConfirmDialog
      open={target !== null}
      onClose={onClose}
      title={`Remove ${target?.label ?? "this member"} from ${organizationName ?? "this organization"}?`}
      description={copy.body}
      confirmLabel={removeButtonLabel({ offer: copy.offer, giveSeat })}
      tone="danger"
      loading={loading}
      onConfirm={() => {
        if (!target) return;
        onConfirm({
          userId: target.userId,
          giveSeatToUserId: copy.offer && giveSeat ? copy.offer.userId : null,
        });
      }}
    >
      {copy.offer && (
        <Box
          borderWidth="1px"
          borderColor="border"
          borderRadius="md"
          paddingX={3}
          paddingY={2.5}
          data-testid="remove-member-give-seat"
        >
          <Checkbox
            checked={giveSeat}
            colorPalette="orange"
            onCheckedChange={(details) => setGiveSeat(details.checked === true)}
          >
            <Text as="span" fontSize="sm">
              <Text as="span" fontWeight="semibold">
                {`${copy.offer.name} is waiting for a seat.`}
              </Text>{" "}
              Give them this seat?
            </Text>
          </Checkbox>
        </Box>
      )}
    </ConfirmDialog>
  );
}
