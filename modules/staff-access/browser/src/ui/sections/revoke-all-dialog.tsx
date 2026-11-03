/** The kill switch's confirmation: the operator types the phrase the server checks. */

import { Dialog } from "@langwatch/design-system/dialog";
import { Field, Input, Text, VStack } from "@langwatch/design-system/primitives";
import { HandledErrorAlert } from "@langwatch/error-views";
import { STAFF_ACCESS_REVOKE_ALL_CONFIRMATION } from "@langwatch/staff-access-contract";
import { useState } from "react";

export function RevokeAllDialog({
  open,
  onClose,
  revoking,
  revokeEverything,
}: {
  open: boolean;
  onClose: () => void;
  revoking: boolean;
  revokeEverything: (input: { confirmation: string }) => Promise<{ revoked: number }>;
}) {
  const [typed, setTyped] = useState("");
  const [mismatch, setMismatch] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const [revoked, setRevoked] = useState<number | null>(null);

  const close = () => {
    setTyped("");
    setMismatch(false);
    setFailure(null);
    setRevoked(null);
    onClose();
  };

  const submit = async () => {
    if (typed.trim() !== STAFF_ACCESS_REVOKE_ALL_CONFIRMATION) {
      setMismatch(true);
      return;
    }
    setFailure(null);
    try {
      setRevoked((await revokeEverything({ confirmation: typed.trim() })).revoked);
    } catch (error) {
      setFailure(error);
    }
  };

  if (revoked !== null) {
    return (
      <Dialog
        open={open}
        onClose={close}
        title="Agent access revoked"
        cancelLabel={null}
        primaryAction={{ label: "Done", onClick: close }}
      >
        <Text data-testid="staff-access-revoke-all-result">
          {revoked === 1
            ? "1 session was ended. Its key stopped working at once."
            : `${revoked} sessions were ended. Their keys stopped working at once.`}
        </Text>
      </Dialog>
    );
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Revoke all agent access"
      description="Every live session from every operator's agent ends now, and its key stops working. Pending requests can no longer be approved. Enrolled agents stay enrolled."
      role="alertdialog"
      busy={revoking}
      onSubmit={() => void submit()}
      primaryAction={{
        type: "submit",
        label: "Revoke all",
        danger: true,
        loading: revoking,
        "data-testid": "staff-access-revoke-all-confirm",
      }}
    >
      <VStack align="stretch" gap={4}>
        <Field.Root invalid={mismatch}>
          <Field.Label>{`Type "${STAFF_ACCESS_REVOKE_ALL_CONFIRMATION}" to confirm`}</Field.Label>
          <Input
            value={typed}
            autoComplete="off"
            data-testid="staff-access-revoke-all-input"
            onChange={(event) => {
              setTyped(event.target.value);
              setMismatch(false);
            }}
          />
          <Field.ErrorText>{`Type "${STAFF_ACCESS_REVOKE_ALL_CONFIRMATION}" exactly.`}</Field.ErrorText>
        </Field.Root>
        {failure !== null && <HandledErrorAlert error={failure} />}
      </VStack>
    </Dialog>
  );
}
