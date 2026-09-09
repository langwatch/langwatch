import { useState } from "react";

import type { DashboardWidgetDraft } from "./DashboardWidgetInPlaceEditor";
import { useWidgetDraft } from "./useWidgetDraft";
import { useWidgetPreview } from "./useWidgetPreview";

/**
 * The in-place editor's draft (seeded from and reverted to the persisted
 * widget), the debounced preview it feeds, and the executor/context that
 * preview runs against. Extracted so `DashboardWidgetInPlaceEditor` stays a
 * thin render over `DashboardWidgetEditDrawer`.
 */
export function useDashboardWidgetInPlaceEditor({
  id,
  widget,
  projectId,
  projectSlug,
  timeWindow,
  onClose,
  onSave,
}: {
  id: string;
  widget: DashboardWidgetDraft;
  projectId: string;
  projectSlug: string;
  timeWindow: { start: number; end: number };
  onClose: () => void;
  onSave: (args: {
    draft: DashboardWidgetDraft;
    onSuccess: () => void;
  }) => void;
}) {
  const [activeTab, setActiveTab] = useState<"code" | "queries">("code");
  const draft = useWidgetDraft({ widget });
  const preview = useWidgetPreview({
    code: draft.draftCode,
    queries: draft.draftQueries,
    projectId,
    projectSlug,
    timeWindow,
    widgetId: id,
  });

  const handleClose = () => {
    draft.resetToWidget();
    // Flush the preview back to the persisted widget synchronously, so a
    // discarded edit can't linger for one debounce into the next open.
    preview.resetPreview(widget.code, widget.queries);
    onClose();
  };

  const handleSave = () => {
    onSave({
      draft: {
        name: draft.draftName,
        code: draft.draftCode,
        queries: draft.draftQueries,
      },
      onSuccess: onClose,
    });
  };

  return {
    ...preview,
    ...draft,
    activeTab,
    setActiveTab,
    handleClose,
    handleSave,
  };
}
