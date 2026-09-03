/**
 * A Datasets success notice, routed to a toast action when it carries an
 * undo — the shared feedback capability carries no action, so undo renders
 * on the toaster's own action trigger instead.
 */

import type { DatasetSuccessNotice } from "@langwatch/dataset-web/screens/datasets";

export function notifyDatasetSuccess({
  notice,
  succeeded,
  createToast,
}: {
  notice: DatasetSuccessNotice;
  succeeded: (notice: DatasetSuccessNotice) => void;
  createToast: (toast: {
    id?: string;
    title: string;
    description?: string;
    type: "success";
    duration?: number;
    action: { label: string; onClick: () => void };
  }) => void;
}): void {
  if (!notice.undo) {
    succeeded(notice);
    return;
  }
  createToast({
    ...(notice.id ? { id: notice.id } : {}),
    title: notice.title,
    ...(notice.description ? { description: notice.description } : {}),
    type: "success",
    ...(notice.durationMs ? { duration: notice.durationMs } : {}),
    action: { label: notice.undo.label, onClick: notice.undo.perform },
  });
}
