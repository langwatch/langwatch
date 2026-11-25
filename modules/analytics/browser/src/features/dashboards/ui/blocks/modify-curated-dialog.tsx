/**
 * Asked at the first change to a From LangWatch board: changing it makes the member's own copy,
 * which stops getting LangWatch's updates (owner, 2026-11-24).
 * @see modules/dashboard/specs/dashboards-v2.feature
 */

import { ConfirmDialog } from "@langwatch/design-system/confirm-dialog";

export const MODIFY_CURATED_TITLE = "Modify a LangWatch dashboard?";

export const MODIFY_CURATED_MESSAGE =
  "This dashboard is maintained by LangWatch. If you change it, it becomes your own copy and " +
  "stops getting LangWatch updates. You can add the original again from Templates at any time.";

export function ModifyCuratedDialog({
  isOpen,
  isModifying,
  onConfirm,
  onCancel,
}: {
  isOpen: boolean;
  isModifying: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <ConfirmDialog
      open={isOpen}
      onClose={onCancel}
      title={MODIFY_CURATED_TITLE}
      description={MODIFY_CURATED_MESSAGE}
      confirmLabel="Yes, modify it"
      tone="default"
      loading={isModifying}
      onConfirm={onConfirm}
    />
  );
}
