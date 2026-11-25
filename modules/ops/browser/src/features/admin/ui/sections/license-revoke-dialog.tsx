import { Dialog } from "@langwatch/design-system/dialog";
import { Field, Text, Textarea } from "@langwatch/design-system/primitives";
import { useEffect, useRef, useState } from "react";

import { api } from "../../../../behavior/ops-api.ts";
import { useShowErrorToast } from "../../../../behavior/ops-feedback.ts";
import { useLicenseCommands } from "../../behavior/use-license-commands.ts";
import { licenseChainState } from "../../model/license-chain.ts";
import type { License } from "../../model/license-terms.ts";

const MIN_REASON_LENGTH = 3;

/**
 * Revokes a license and every live license of its reissue chain, read here so
 * the table and the drawer revoke the same set: a replacement waiting for sync
 * would otherwise stay live. A retry skips the rows an earlier attempt revoked.
 */
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
  const revokedRef = useRef(new Set<string>());
  const commands = useLicenseCommands();
  const showErrorToast = useShowErrorToast();
  const chainQuery = api.licenseRegistry.getChain.useQuery(
    { id: license?.id ?? "" },
    { enabled: license !== null, retry: false },
  );
  const chain = chainQuery.data ? licenseChainState({ licenses: chainQuery.data.licenses }) : null;
  const invalid = attempts > 0 && reason.trim().length < MIN_REASON_LENGTH;
  const busy = commands.revoke.isPending || commands.revokeQuietly.isPending;

  useEffect(() => {
    if (!license) return;
    setReason("");
    setAttempts(0);
    revokedRef.current = new Set();
  }, [license]);

  useEffect(() => {
    if (attempts > 0) reasonRef.current?.focus();
  }, [attempts]);

  const submit = () => {
    if (!license || !chain || busy) return;
    if (reason.trim().length < MIN_REASON_LENGTH) {
      setAttempts((count) => count + 1);
      return;
    }
    const revoked = revokedRef.current;
    const others = chain.live.filter((row) => row.id !== license.id && !revoked.has(row.id));
    void (async () => {
      for (const row of others) {
        await commands.revokeQuietly.mutateAsync({ id: row.id, reason: reason.trim() });
        revoked.add(row.id);
      }
      commands.revoke.mutate({ id: license.id, reason: reason.trim() }, { onSuccess: onClose });
    })().catch((error: unknown) =>
      showErrorToast({ error, fallbackTitle: "The license was not revoked" }),
    );
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
        loading: busy || chainQuery.isLoading,
        ...(chainQuery.error
          ? { disabledReason: "The licenses revoked with this one could not be read" }
          : {}),
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
      {chainQuery.error ? (
        <Text color="fg.error" fontSize="sm">
          Couldn't read the licenses revoked with this one. Close and try again.
        </Text>
      ) : null}
    </Dialog>
  );
}
