import type { DataPrivacyRule } from "@langwatch/data-privacy-contract";
import { Dialog } from "@langwatch/design-system/dialog";
import { Button, Text } from "@langwatch/design-system/primitives";

/** Confirms deleting a privacy rule, since removing one can relax redaction. */
export function RemoveRuleConfirmDialog({
  rule,
  isRemoving,
  onCancel,
  onConfirm,
}: {
  rule: DataPrivacyRule | null;
  isRemoving: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  return (
    <Dialog.Root
      open={!!rule}
      onOpenChange={({ open }) => {
        if (!open) onCancel();
      }}
    >
      <Dialog.Content>
        <Dialog.CloseTrigger />
        <Dialog.Header>
          <Dialog.Title>Delete privacy rule{rule ? ` for ${rule.name}` : ""}?</Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          <Text>
            Deleting this rule may relax how trace content, secrets and PII are redacted at this
            scope. The next applicable rule, or the platform default, applies from now on.
          </Text>
        </Dialog.Body>
        <Dialog.Footer>
          <Button variant="outline" onClick={onCancel} disabled={isRemoving}>
            Cancel
          </Button>
          <Button colorPalette="red" loading={isRemoving} onClick={() => void onConfirm()}>
            Delete rule
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}
