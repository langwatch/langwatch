import type { DataPrivacyRule } from "@langwatch/data-privacy-contract";
import { ConfirmDialog } from "@langwatch/design-system/confirm-dialog";

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
    <ConfirmDialog
      open={!!rule}
      onClose={onCancel}
      onConfirm={() => void onConfirm()}
      title={`Delete privacy rule${rule ? ` for ${rule.name}` : ""}?`}
      description="Deleting this rule may relax how trace content, secrets and PII are redacted at this scope. The next applicable rule, or the platform default, applies from now on."
      confirmLabel="Delete rule"
      loading={isRemoving}
    />
  );
}
