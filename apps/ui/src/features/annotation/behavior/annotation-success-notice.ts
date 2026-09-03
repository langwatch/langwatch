/**
 * Where an annotation confirmation's optional link is rendered.
 *
 * The shared feedback capability carries a title and a description and no
 * action, so a notice that has one is rendered on the Design System toaster's
 * own action trigger instead. Everything without one still goes through the
 * capability, which is what keeps the code-keyed copy deciding the words a
 * customer reads.
 */

import { toaster } from "@langwatch/design-system/toaster";
import type { AnnotationSuccessNotice } from "@langwatch/annotation-web/screens/annotations";

export function presentAnnotationSuccess({
  notice,
  succeeded,
}: {
  notice: AnnotationSuccessNotice;
  succeeded: (notice: AnnotationSuccessNotice) => void;
}): void {
  if (!notice.action) {
    succeeded(notice);
    return;
  }
  toaster.create({
    ...(notice.id ? { id: notice.id } : {}),
    title: notice.title,
    ...(notice.description ? { description: notice.description } : {}),
    type: "success",
    action: { label: notice.action.label, onClick: notice.action.perform },
  });
}
