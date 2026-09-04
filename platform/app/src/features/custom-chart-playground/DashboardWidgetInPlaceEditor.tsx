/**
 * The edit drawer for a dashboard widget that already sits on a dashboard
 * grid: the same `DashboardWidgetEditDrawer` the create flow uses, owning the
 * draft (name, code, queries) for one persisted row and handing the parent a
 * single `onSave` with the final draft.
 *
 * The chart previews the draft LIVE. The frame's `code` and the executor's
 * queries are fed from a DEBOUNCED copy of the draft rather than the draft
 * itself: the frame is a full remount (fresh CDN scripts, a fresh Babel
 * compile) on every identity change, and doing that on every keystroke would
 * be exactly as janky as it sounds.
 *
 * Closing (Cancel, the drawer's own close trigger, or clicking outside)
 * reverts the draft, so a discarded edit can never sit around for the next
 * open to reveal.
 */

import { useEffect, useState } from "react";

import { useColorMode } from "~/components/ui/color-mode";
import type { DashboardWidgetQuery } from "~/server/analytics/dashboardWidgetDefinition";

import { DashboardWidgetEditDrawer } from "./DashboardWidgetEditDrawer";
import { SandboxedChartFrame } from "./SandboxedChartFrame";
import { useDashboardWidgetChartNavigate } from "./useDashboardWidgetChartNavigate";
import { useDashboardWidgetExecutor } from "./useDashboardWidgetExecutor";

/** The drawer's chart preview isn't grid-constrained: a fixed, generous height. */
const DRAWER_PREVIEW_HEIGHT_PX = 320;

/** How long the draft sits idle before the chart preview re-mounts. */
const PREVIEW_DEBOUNCE_MS = 600;

// The drawer surfaces frame output in the chart itself; no log panel.
const noopLog = () => {
  // Intentionally empty.
};

/** Cheap and correct at this scale: a widget's queries are a handful of small objects. */
const queriesEqual = (
  a: DashboardWidgetQuery[],
  b: DashboardWidgetQuery[],
): boolean => JSON.stringify(a) === JSON.stringify(b);

export interface DashboardWidgetDraft {
  name: string;
  code: string;
  queries: DashboardWidgetQuery[];
}

interface DashboardWidgetInPlaceEditorProps {
  open: boolean;
  id: string;
  /** The persisted widget the draft is seeded from and reverted to. */
  widget: DashboardWidgetDraft;
  projectId: string;
  /** Host context for `LW.navigate` from the preview frame. */
  projectSlug: string;
  /** The window the preview's queries run against: the dashboard's own period. */
  timeWindow: { start: number; end: number };
  isSaving: boolean;
  onClose: () => void;
  onSave: (
    draft: DashboardWidgetDraft,
    options: { onSuccess: () => void },
  ) => void;
}

export function DashboardWidgetInPlaceEditor({
  open,
  id,
  widget,
  projectId,
  projectSlug,
  timeWindow,
  isSaving,
  onClose,
  onSave,
}: DashboardWidgetInPlaceEditorProps) {
  const { colorMode } = useColorMode();
  const onNavigate = useDashboardWidgetChartNavigate(projectSlug);

  const [activeTab, setActiveTab] = useState<"code" | "queries">("code");
  const [draftName, setDraftName] = useState(widget.name);
  const [draftCode, setDraftCode] = useState(widget.code);
  const [draftQueries, setDraftQueries] = useState(widget.queries);

  // Reseed whenever the persisted record changes underneath the draft: a save
  // from this drawer, or a refetch.
  useEffect(() => {
    setDraftName(widget.name);
    setDraftCode(widget.code);
    setDraftQueries(widget.queries);
  }, [widget.name, widget.code, widget.queries]);

  const [previewCode, setPreviewCode] = useState(widget.code);
  const [previewQueries, setPreviewQueries] = useState(widget.queries);
  useEffect(() => {
    const timer = setTimeout(() => {
      setPreviewCode(draftCode);
      setPreviewQueries(draftQueries);
    }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [draftCode, draftQueries]);

  const { executeQuery, runStandalone, params, lastRuns } =
    useDashboardWidgetExecutor(projectId, previewQueries, { timeWindow });

  const isDirty =
    draftName !== widget.name ||
    draftCode !== widget.code ||
    !queriesEqual(draftQueries, widget.queries);

  const handleClose = () => {
    setDraftName(widget.name);
    setDraftCode(widget.code);
    setDraftQueries(widget.queries);
    onClose();
  };

  const handleSave = () => {
    onSave(
      { name: draftName, code: draftCode, queries: draftQueries },
      { onSuccess: onClose },
    );
  };

  return (
    <DashboardWidgetEditDrawer
      open={open}
      id={id}
      name={draftName}
      onNameChange={setDraftName}
      code={draftCode}
      queries={draftQueries}
      onCodeChange={setDraftCode}
      onQueriesChange={setDraftQueries}
      lastRuns={lastRuns}
      onRun={runStandalone}
      isDirty={isDirty}
      isSaving={isSaving}
      onClose={handleClose}
      onSave={handleSave}
      activeTab={activeTab}
      onTabChange={setActiveTab}
      chart={
        open ? (
          <SandboxedChartFrame
            key={`${previewCode}::${JSON.stringify(previewQueries)}`}
            code={previewCode}
            executeQuery={executeQuery}
            params={params}
            theme={colorMode === "dark" ? "dark" : "light"}
            onLog={noopLog}
            onNavigate={onNavigate}
            maxHeight={DRAWER_PREVIEW_HEIGHT_PX}
          />
        ) : null
      }
    />
  );
}
