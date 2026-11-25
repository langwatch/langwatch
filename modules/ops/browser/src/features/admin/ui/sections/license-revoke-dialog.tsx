import { Dialog } from "@langwatch/design-system/dialog";
import { Field, Text, Textarea } from "@langwatch/design-system/primitives";
import { useEffect, useRef, useState } from "react";

import { api } from "../../../../behavior/ops-api.ts";
import { useShowErrorToast } from "../../../../behavior/ops-feedback.ts";
import { useLicenseCommands } from "../../behavior/use-license-commands.ts";
import { licenseChainState } from "../../model/license-chain.ts";
import type { License } from "../../model/license-terms.ts";

const MIN_REASON_LENGTH = 3;

type RevokeInput = { id: string; reason: string };

/**
 * Revokes the chain's other live licenses and says whether the selected one is
 * still live. The server may have revoked it on an attempt whose answer failed.
 */
async function revokeOthers({
  live,
  licenseId,
  reason,
  revokeQuietly,
}: {
  live: License[];
  licenseId: string;
  reason: string;
  revokeQuietly: (input: RevokeInput) => Promise<unknown>;
}): Promise<boolean> {
  for (const row of live) {
    if (row.id !== licenseId) await revokeQuietly({ id: row.id, reason });
  }
  return live.some((row) => row.id === licenseId);
}

/**
 * Revokes a license and every live license of its reissue chain. The chain is
 * read again when the operator confirms, so a replacement signed since the
 * dialog opened is revoked too, and a retry skips rows the server revoked.
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
    void (async () => {
      const fresh = await chainQuery.refetch({ throwOnError: true });
      if (!fresh.data) throw new Error("the chain could not be read");
      const stillLive = await revokeOthers({
        live: licenseChainState({ licenses: fresh.data.licenses })?.live ?? [],
        licenseId: license.id,
        reason: reason.trim(),
        revokeQuietly: (input) => commands.revokeQuietly.mutateAsync(input),
      });
      if (!stillLive) return onClose();
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
