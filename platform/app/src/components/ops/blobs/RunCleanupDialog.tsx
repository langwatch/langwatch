import { Input } from "@chakra-ui/react";

import { ConfirmDialog } from "~/components/ops/shared/ConfirmDialog";

/** Typed in full before the destructive sweep unlocks. */
const REQUIRED_WORD = "RECLAIM";

export function RunCleanupDialog({
  value,
  onChange,
  onClose,
  onConfirm,
  isLoading,
}: {
  /** What the operator has typed so far; null closes the dialog. */
  value: string | null;
  onChange: (value: string) => void;
  onClose: () => void;
  onConfirm: () => void;
  isLoading: boolean;
}) {
  const satisfied = value === REQUIRED_WORD;

  return (
    <ConfirmDialog
      open={value !== null}
      onClose={onClose}
      onConfirm={() => {
        if (satisfied) onConfirm();
      }}
      title="Run cleanup"
      description={`Payloads nothing references will be deleted. Type ${REQUIRED_WORD} to confirm.`}
      isLoading={isLoading}
      confirmDisabled={!satisfied}
    >
      <Input
        size="sm"
        aria-label={`Type ${REQUIRED_WORD} to confirm`}
        placeholder={REQUIRED_WORD}
        value={value ?? ""}
        onChange={(e) => onChange(e.currentTarget.value)}
      />
    </ConfirmDialog>
  );
}
