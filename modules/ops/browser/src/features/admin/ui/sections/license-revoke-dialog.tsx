import { Dialog } from "@langwatch/design-system/dialog";
import { Field, Textarea } from "@langwatch/design-system/primitives";
import { useEffect, useRef, useState } from "react";

import { useLicenseCommands } from "../../behavior/use-license-commands.ts";
import type { License } from "../../model/license-terms.ts";

const MIN_REASON_LENGTH = 3;

export function LicenseRevokeDialog({
  license,
  onClose,
}: {
  license: License | null;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [attempts, setAttempts] = useState(0);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const commands = useLicenseCommands();
  const invalid = attempts > 0 && reason.trim().length < MIN_REASON_LENGTH;

  useEffect(() => {
    if (!license) return;
    setReason("");
    setAttempts(0);
  }, [license]);

  useEffect(() => {
    if (attempts > 0) reasonRef.current?.focus();
  }, [attempts]);

  const submit = () => {
    if (!license || commands.revoke.isPending) return;
    if (reason.trim().length < MIN_REASON_LENGTH) {
      setAttempts((count) => count + 1);
      return;
    }
    commands.revoke.mutate({ id: license.id, reason: reason.trim() }, { onSuccess: onClose });
  };

  return (
    <Dialog
      open={license !== null}
      onClose={onClose}
      title={`Revoke the license of ${license?.organizationName ?? ""}`}
      description="The install keeps working offline on the license it holds, but it can no longer reach LangWatch-hosted services or sync. This cannot be undone; issue a new license to restore access."
      onSubmit={submit}
      primaryAction={{
        label: "Revoke license",
        type: "submit",
        danger: true,
        loading: commands.revoke.isPending,
      }}
    >
      <Field.Root required invalid={invalid}>
        <Field.Label>Reason</Field.Label>
        <Textarea
          ref={reasonRef}
          rows={3}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Why this license is revoked, for the audit log"
          aria-invalid={invalid || undefined}
        />
        <Field.ErrorText>
          Give a reason of at least {MIN_REASON_LENGTH} characters, for the audit log.
        </Field.ErrorText>
      </Field.Root>
    </Dialog>
  );
}
