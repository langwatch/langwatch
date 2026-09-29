import { Field, Textarea, VStack } from "@chakra-ui/react";
import { useEffect, useState } from "react";

import { ConfirmDialog } from "../../../../ui/elements/ops-confirm-dialog.tsx";
import { useLicenseCommands } from "../../behavior/use-license-commands.ts";
import type { License } from "../../model/license-terms.ts";

export function LicenseRevokeDialog({
  license,
  onClose,
}: {
  license: License | null;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const commands = useLicenseCommands();

  useEffect(() => {
    if (license) setReason("");
  }, [license]);

  return (
    <ConfirmDialog
      open={license !== null}
      onClose={onClose}
      onConfirm={() => {
        if (!license) return;
        commands.revoke.mutate({ id: license.id, reason: reason.trim() }, { onSuccess: onClose });
      }}
      title={`Revoke the license of ${license?.organizationName ?? ""}`}
      description="The install keeps working offline on the license it holds, but it can no longer reach LangWatch-hosted services or sync. This cannot be undone; issue a new license to restore access."
      isLoading={commands.revoke.isPending}
      confirmDisabled={reason.trim().length < 3}
    >
      <VStack align="start" gap={3}>
        <Field.Root required>
          <Field.Label>Reason</Field.Label>
          <Textarea
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Why this license is revoked, for the audit log"
          />
        </Field.Root>
      </VStack>
    </ConfirmDialog>
  );
}
