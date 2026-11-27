/** The kill switch's confirmation: the operator types the phrase the server checks. */

import { Dialog } from "@langwatch/design-system/dialog";
import { Alert, Field, Input, Text, VStack } from "@langwatch/design-system/primitives";
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
  revokeEverything: (input: {
    confirmation: string;
  }) => Promise<{ revoked: number; failed: number }>;
}) {
  const [typed, setTyped] = useState("");
  const [mismatch, setMismatch] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const [result, setResult] = useState<{ revoked: number; failed: number } | null>(null);

  const close = () => {
    setTyped("");
    setMismatch(false);
    setFailure(null);
    setResult(null);
    onClose();
  };

  const submit = async () => {
    if (typed.trim() !== STAFF_ACCESS_REVOKE_ALL_CONFIRMATION) {
      setMismatch(true);
      return;
    }
    setFailure(null);
    try {
      setResult(await revokeEverything({ confirmation: typed.trim() }));
    } catch (error) {
      setFailure(error);
    }
  };

  if (result !== null) {
    return (
      <Dialog
        open={open}
        onClose={close}
        title="Agent access revoked"
        cancelLabel={null}
        primaryAction={{ label: "Done", onClick: close }}
      >
        <VStack align="stretch" gap={3}>
          <Text data-testid="staff-access-revoke-all-result">
            {result.revoked === 1
              ? "1 session was ended. Its key stopped working at once."
              : `${result.revoked} sessions were ended. Their keys stopped working at once.`}
          </Text>
          {result.failed > 0 && (
            <Alert.Root status="warning" data-testid="staff-access-revoke-all-failed">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Title>
                  {result.failed === 1
                    ? "1 session did not end cleanly"
                    : `${result.failed} sessions did not end cleanly`}
                </Alert.Title>
                <Alert.Description>Run Revoke all again to retry them.</Alert.Description>
              </Alert.Content>
            </Alert.Root>
          )}
        </VStack>
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
