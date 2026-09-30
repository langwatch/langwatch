// The confirmation before a grant is revoked: who loses which role where.

import { ConfirmDialog } from "@langwatch/design-system/confirm-dialog";

import { type GrantRow, grantPrincipalText, grantScopeText } from "./grants.ts";

export type RevokeGrantDialogProps = {
  /** The grant about to be revoked; null keeps the dialog closed. */
  grant: GrantRow | null;
  loading: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function RevokeGrantDialog({ grant, loading, onConfirm, onCancel }: RevokeGrantDialogProps) {
  return (
    <ConfirmDialog
      open={!!grant}
      onOpenChange={(isOpen) => {
        if (!isOpen) onCancel();
      }}
      title="Revoke this access"
      message={
        grant
          ? `${grantPrincipalText(grant.principal)} loses ${grant.role.name ?? grant.role.id} on ${grantScopeText(grant.scope)}.`
          : ""
      }
      confirmLabel="Revoke"
      tone="danger"
      loading={loading}
      onConfirm={onConfirm}
    />
  );
}
