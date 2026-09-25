import { useMemo, useState } from "react";
import type { DashboardWidgetQuery } from "~/server/analytics/dashboardWidgetDefinition";

import type { DashboardWidget } from "./DashboardWidgetCard";
import { useFrameDiagnostic } from "./useFrameDiagnostic";
import { useWidgetDraft } from "./useWidgetDraft";
import { useWidgetPreview } from "./useWidgetPreview";

/** Session time-range chip options — unpersisted, pure React state. */
export const RANGE_MS = {
  "1h": 3_600_000,
  "24h": 86_400_000,
  "7d": 604_800_000,
  "30d": 2_592_000_000,
} as const;
export type RangeKey = keyof typeof RANGE_MS;
export const RANGE_LABEL: Record<RangeKey, string> = {
  "1h": "Last 1h",
  "24h": "Last 24h",
  "7d": "Last 7d",
  "30d": "Last 30d",
};

type SaveWidget = (
  input: {
    id: string;
    name?: string;
    code: string;
    queries: DashboardWidgetQuery[];
  },
  options?: { onSuccess?: () => void },
) => void;

/**
 * Everything a `DashboardWidgetCard` needs that is not JSX, composed from the
 * shared draft and preview hooks plus this card's own session range and drawer
 * control. Kept out of the card so it and its subcomponents stay pure
 * presentation.
 */
export function useDashboardWidgetCard({
  widget,
  projectId,
  projectSlug,
  onSave,
}: {
  widget: DashboardWidget;
  projectId: string;
  projectSlug: string;
  onSave: SaveWidget;
}) {
  const [rangeKey, setRangeKey] = useState<RangeKey>("24h");
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  // Memo on rangeKey only — a fresh {start, end} identity every render would
  // loop the executor's refetch.
  const timeWindow = useMemo(() => {
    const end = Date.now();
    return { start: end - RANGE_MS[rangeKey], end };
  }, [rangeKey]);

  // Frozen while the drawer edits: the drawer previews the live draft, so a
  // background refetch must not reseed and overwrite an in-progress edit.
  const draft = useWidgetDraft({ widget, isFrozen: isDrawerOpen });
  const preview = useWidgetPreview({
    code: draft.draftCode,
    queries: draft.draftQueries,
    projectId,
    projectSlug,
    timeWindow,
    widgetId: widget.id,
    dashboardId: widget.dashboardId ?? undefined,
    widgetName: widget.name,
  });

  // A compile or render error the widget reports is shown on the card.
  const { diagnostic, onLog } = useFrameDiagnostic({
    resetKey: preview.previewCode,
  });

  const drawer = useDashboardWidgetCardDrawer({
    widget,
    draft,
    preview,
    onSave,
    isDrawerOpen,
    setIsDrawerOpen,
  });

  return {
    ...preview,
    ...draft,
    ...drawer,
    rangeKey,
    setRangeKey,
    diagnostic,
    onLog,
  };
}

/**
 * The card's own edit-drawer control: whether it's open, its active tab, and
 * the save/rename/open/close handlers that operate on the draft.
 */
function useDashboardWidgetCardDrawer({
  widget,
  draft,
  preview,
  onSave,
  isDrawerOpen,
  setIsDrawerOpen,
}: {
  widget: DashboardWidget;
  draft: ReturnType<typeof useWidgetDraft>;
  preview: ReturnType<typeof useWidgetPreview>;
  onSave: SaveWidget;
  isDrawerOpen: boolean;
  setIsDrawerOpen: (open: boolean) => void;
}) {
  const [drawerTab, setDrawerTab] = useState<"code" | "queries">("code");

  const handleSave = () => {
    onSave(
      {
        id: widget.id,
        name: draft.draftName,
        code: draft.draftCode,
        queries: draft.draftQueries,
      },
      { onSuccess: () => setIsDrawerOpen(false) },
    );
  };

  // A standalone rename, straight from the card's own title — deliberately
  // resaves the widget's CURRENT persisted code/queries, not whatever draft
  // might be sitting in the (closed) drawer, so renaming here can never
  // smuggle in an unrelated in-progress edit.
  const handleRename = (newName: string) => {
    onSave({
      id: widget.id,
      name: newName,
      code: widget.code,
      queries: widget.queries,
    });
  };

  const openCodeTab = () => {
    setDrawerTab("code");
    setIsDrawerOpen(true);
  };

  // Reverts the draft AND closes — covers Cancel, the drawer's own close
  // trigger, and clicking outside it, so none of the three can leave a
  // discarded edit sitting in the draft for the next open to reveal. The
  // preview is flushed with it so the next open can't flash the discarded
  // edit for one debounce.
  const handleClose = () => {
    draft.resetToWidget();
    preview.resetPreview(widget.code, widget.queries);
    setIsDrawerOpen(false);
  };

  return {
    isDrawerOpen,
    drawerTab,
    setDrawerTab,
    handleSave,
    handleRename,
    openCodeTab,
    handleClose,
  };
}

export type DashboardWidgetCardViewModel = ReturnType<
  typeof useDashboardWidgetCard
>;
