import { Dialog } from "@langwatch/design-system/dialog";
import { Text } from "@langwatch/design-system/primitives";

const ACCESS_PROBLEM = {
  loading: "Checking your access",
  failed: "Couldn't check your access. Reload the page to try again",
  ready: undefined,
} as const;

/**
 * Revoking the legacy project key swaps it for an API key on the same project,
 * so the reader is told up front that they create the new key and the old one dies.
 */
export function RevokeLegacyKeyDialog({
  open,
  projectName,
  access,
  onClose,
  onConfirm,
}: {
  open: boolean;
  projectName: string | undefined;
  /** Whether the reader's roles are known, which decide the new key's type and role. */
  access: "loading" | "failed" | "ready";
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Revoke the legacy project key?"
      size="md"
      role="alertdialog"
      primaryAction={{
        label: "Revoke",
        danger: true,
        onClick: onConfirm,
        disabledReason: ACCESS_PROBLEM[access],
        "data-testid": "legacy-key-revoke-confirm",
      }}
    >
      <Text>
        Next you create a new API key for {projectName ?? "this project"}, which we show to you
        once. Once it is created, the legacy key stops working within seconds. Put the new key
        wherever the legacy key was used.
      </Text>
    </Dialog>
  );
}
