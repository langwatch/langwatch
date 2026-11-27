/**
 * The template gallery with its data: mounted by the rail only while open, so the template list
 * is read when someone asks for it.
 * @see modules/scenario/specs/suite-template-gallery.feature
 */

import type { AppliedSuiteTemplate } from "@langwatch/suite-contract";

import { SuiteTemplateGalleryDialog } from "./suite-template-gallery-dialog.tsx";
import { useSuiteTemplateGallery } from "./use-suite-template-gallery.ts";

export function SuiteTemplateGallery({
  projectId,
  onClose,
  onCreated,
}: {
  projectId: string | undefined;
  onClose: () => void;
  onCreated: (applied: AppliedSuiteTemplate) => void;
}) {
  const gallery = useSuiteTemplateGallery({ projectId, onCreated });
  return (
    <SuiteTemplateGalleryDialog
      open
      onClose={onClose}
      templates={gallery.templates}
      isLoading={gallery.isLoading}
      loadFailed={gallery.loadFailed}
      onRetry={gallery.retry}
      isCreating={gallery.isCreating}
      onCreate={gallery.create}
    />
  );
}
