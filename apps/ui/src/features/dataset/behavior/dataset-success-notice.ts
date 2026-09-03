/**
 * A Datasets success notice, routed to a toast action when it carries an undo.
 *
 * THE UNDO IS RENDERED ON THE TOASTER'S OWN ACTION TRIGGER. The feedback
 * capability carries a title and a description and no action, and widening it
 * is a change to a shared port a page move does not own; the platform page put
 * an Undo button inside the toast, and a toast action is the same affordance
 * without the JSX. Everything else — every notice without an undo — goes
 * through the capability, so the code-keyed copy still decides the words a
 * customer reads.
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
