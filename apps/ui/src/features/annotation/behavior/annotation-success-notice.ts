/**
 * Where an annotation confirmation's optional link is rendered: the shared
 * feedback capability carries no action, so a notice with one renders on
 * the Design System toaster's own action trigger instead.
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
