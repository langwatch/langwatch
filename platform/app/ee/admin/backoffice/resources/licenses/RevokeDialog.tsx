import {
  Button,
  Field,
  HStack,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import { useEffect, useState } from "react";
import { Dialog } from "~/components/ui/dialog";
import type { License } from "./types";
import { useLicenseCommands } from "./useLicenseCommands";

export function RevokeDialog({
  license,
  onClose,
}: {
  license: License | null;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (license) setReason("");
  }, [license]);

  return (
    <Dialog.Root
      open={license !== null}
      onOpenChange={({ open }) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Content onClick={(event) => event.stopPropagation()}>
        <Dialog.Header>
          <Dialog.Title>
            Revoke the license of {license?.organizationName}
          </Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          <RevokeReason reason={reason} onReasonChange={setReason} />
        </Dialog.Body>
        <Dialog.Footer>
          <RevokeActions license={license} reason={reason} onClose={onClose} />
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}

function RevokeReason({
  reason,
  onReasonChange,
}: {
  reason: string;
  onReasonChange: (value: string) => void;
}) {
  return (
    <VStack align="start" gap={3}>
      <Text fontSize="sm">
        The install keeps working offline on the license it holds, but it can no
        longer reach LangWatch-hosted services or sync. This cannot be undone;
        issue a new license to restore access.
      </Text>
      <Field.Root required>
        <Field.Label>Reason</Field.Label>
        <Textarea
          rows={3}
          value={reason}
          onChange={(event) => onReasonChange(event.target.value)}
          placeholder="Why this license is revoked, for the audit log"
        />
      </Field.Root>
    </VStack>
  );
}

function RevokeActions({
  license,
  reason,
  onClose,
}: {
  license: License | null;
  reason: string;
  onClose: () => void;
}) {
  const commands = useLicenseCommands();

  return (
    <HStack gap={3}>
      <Button variant="outline" onClick={onClose}>
        Cancel
      </Button>
      <Button
        colorPalette="red"
        disabled={reason.trim().length < 3}
        loading={commands.revoke.isPending}
        onClick={() => {
          if (!license) return;
          commands.revoke.mutate(
            { id: license.id, reason: reason.trim() },
            { onSuccess: onClose },
          );
        }}
      >
        Revoke
      </Button>
    </HStack>
  );
}
