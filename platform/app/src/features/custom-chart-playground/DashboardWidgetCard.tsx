/**
 * One persisted dashboard widget: a sortable card showing only its chart —
 * a sandboxed frame, a title, and a size/edit/delete menu. All editing (the
 * React/TSX file, the declared queries) happens in `DashboardWidgetEditDrawer`,
 * which this card owns and opens from the menu's Edit item.
 *
 * The frame never holds SQL or the projectId — the parent does. Each
 * `LW.query(name, params)` from the frame is resolved here, through the same
 * abortable LangWatchQL executor the workbench uses (`useDashboardWidgetExecutor`).
 *
 * The chart previews the drawer's draft LIVE, not just the persisted widget —
 * that's the "save-less feedback" the drawer promises. The frame's `code` and
 * the executor's queries are both fed from a DEBOUNCED copy of the draft
 * rather than the draft itself: the frame is a full remount (fresh CDN
 * scripts, a fresh Babel compile) on every identity change, and doing that on
 * every keystroke would be exactly as janky as it sounds.
 */

import { Box, Button, Card, HStack, Text } from "@chakra-ui/react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Clock } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { SizeOption } from "~/components/analytics/reports/GraphCardMenu";
import { GraphCardMenu } from "~/components/analytics/reports/GraphCardMenu";
import { useColorMode } from "~/components/ui/color-mode";
import { Menu } from "~/components/ui/menu";
import type { DashboardWidgetQuery } from "~/server/analytics/dashboardWidgetDefinition";

import { DashboardWidgetEditDrawer } from "./DashboardWidgetEditDrawer";
import { SandboxedChartFrame } from "./SandboxedChartFrame";
import { useDashboardWidgetChartNavigate } from "./useDashboardWidgetChartNavigate";
import { useDashboardWidgetExecutor } from "./useDashboardWidgetExecutor";

/** A dashboard widget as the grid renders it. */
export interface DashboardWidget {
  id: string;
  name: string;
  code: string;
  queries: DashboardWidgetQuery[];
  gridColumn: number;
  gridRow: number;
  colSpan: number;
  rowSpan: number;
  dashboardId?: string | null;
}

/** The height a card's row span grants its frame — mirrors the report grid. */
const rowSpanHeight = (rowSpan: number): number => (rowSpan === 2 ? 600 : 300);

/** The drawer's own chart preview isn't grid-constrained — a fixed, generous height. */
const DRAWER_PREVIEW_HEIGHT_PX = 320;

/** How long the drawer's draft sits idle before the chart preview re-mounts. */
const PREVIEW_DEBOUNCE_MS = 600;

// The playground surfaces frame output in the chart itself; no log panel.
const noopLog = () => {
  // Intentionally empty.
};

/** Cheap and correct at this scale: a widget's queries are a handful of small objects. */
function queriesEqual(a: DashboardWidgetQuery[], b: DashboardWidgetQuery[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Session time-range chip options — unpersisted, pure React state. */
const RANGE_MS = {
  "1h": 3_600_000,
  "24h": 86_400_000,
  "7d": 604_800_000,
  "30d": 2_592_000_000,
} as const;
type RangeKey = keyof typeof RANGE_MS;
const RANGE_LABEL: Record<RangeKey, string> = {
  "1h": "Last 1h",
  "24h": "Last 24h",
  "7d": "Last 7d",
  "30d": "Last 30d",
};

interface DashboardWidgetCardProps {
  widget: DashboardWidget;
  projectId: string;
  projectSlug: string;
  onDelete: () => void;
  onSizeChange: (size: SizeOption) => void;
  onSave: (
    input: { id: string; code: string; queries: DashboardWidgetQuery[] },
    options?: { onSuccess?: () => void },
  ) => void;
  isDeleting: boolean;
  isSaving: boolean;
}

export function DashboardWidgetCard({
  widget,
  projectId,
  projectSlug,
  onDelete,
  onSizeChange,
  onSave,
  isDeleting,
  isSaving,
}: DashboardWidgetCardProps) {
  const { colorMode } = useColorMode();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: widget.id });

  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<"code" | "queries">("code");
  const [draftCode, setDraftCode] = useState(widget.code);
  const [draftQueries, setDraftQueries] = useState(widget.queries);

  const [rangeKey, setRangeKey] = useState<RangeKey>("24h");
  // Memo on rangeKey only — a fresh {start, end} identity every render would
  // loop the executor's refetch.
  const timeWindow = useMemo(() => {
    const end = Date.now();
    return { start: end - RANGE_MS[rangeKey], end };
  }, [rangeKey]);

  // Reseed the drafts whenever the persisted record changes underneath them:
  // a save from this card, or a refetch.
  useEffect(() => {
    setDraftCode(widget.code);
    setDraftQueries(widget.queries);
  }, [widget.code, widget.queries]);

  // The chart's own view of the draft, updated only after typing settles —
  // see the file header for why this can't just be draftCode/draftQueries.
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
  const onNavigate = useDashboardWidgetChartNavigate(projectSlug);

  const isDirty =
    draftCode !== widget.code || !queriesEqual(draftQueries, widget.queries);

  const handleSave = () => {
    onSave(
      { id: widget.id, code: draftCode, queries: draftQueries },
      { onSuccess: () => setIsDrawerOpen(false) },
    );
  };

  const openCodeTab = () => {
    setDrawerTab("code");
    setIsDrawerOpen(true);
  };

  // Reverts the draft AND closes — covers Cancel, the drawer's own close
  // trigger, and clicking outside it, so none of the three can leave a
  // discarded edit sitting in the draft for the next open to reveal.
  const handleClose = () => {
    setDraftCode(widget.code);
    setDraftQueries(widget.queries);
    setIsDrawerOpen(false);
  };

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    gridColumn: `span ${widget.colSpan}`,
    gridRow: `span ${widget.rowSpan}`,
  };

  return (
    <Box ref={setNodeRef} style={style} minWidth={0}>
      <Card.Root height="full" minWidth={0}>
        <Card.Body
          height="full"
          display="flex"
          flexDirection="column"
          minWidth={0}
          overflow="hidden"
          gap={2}
        >
          <HStack minWidth={0} cursor="grab" {...attributes} {...listeners}>
            <Text
              fontSize="sm"
              fontWeight="bold"
              flex={1}
              minWidth={0}
              truncate
            >
              {widget.name}
            </Text>

            <Menu.Root>
              <Menu.Trigger asChild>
                <Button variant="ghost" size="xs">
                  <Clock /> {RANGE_LABEL[rangeKey]}
                </Button>
              </Menu.Trigger>
              <Menu.Content>
                {(Object.keys(RANGE_MS) as RangeKey[]).map((key) => (
                  <Menu.Item
                    key={key}
                    value={key}
                    onClick={() => setRangeKey(key)}
                  >
                    {RANGE_LABEL[key]}
                    {key === rangeKey && " ✓"}
                  </Menu.Item>
                ))}
              </Menu.Content>
            </Menu.Root>

            <GraphCardMenu
              graphId={widget.id}
              projectId={projectId}
              projectSlug={projectSlug}
              dashboardId={widget.dashboardId ?? undefined}
              colSpan={widget.colSpan}
              rowSpan={widget.rowSpan}
              isDashboardWidget
              showAddToDashboard
              onEdit={openCodeTab}
              onSizeChange={onSizeChange}
              onDelete={onDelete}
              isDeleting={isDeleting}
            />
          </HStack>

          {/* Not rendered while the drawer is open — the drawer mounts its
              own copy of this same frame instead, so there is never more
              than one live iframe (and one LW.query dispatch) running the
              same preview at once. */}
          {!isDrawerOpen && (
            <Box flex={1} minHeight={0}>
              <SandboxedChartFrame
                key={`${previewCode}\u0000${JSON.stringify(previewQueries)}`}
                code={previewCode}
                executeQuery={executeQuery}
                params={params}
                theme={colorMode === "dark" ? "dark" : "light"}
                onLog={noopLog}
                onNavigate={onNavigate}
                maxHeight={rowSpanHeight(widget.rowSpan)}
              />
            </Box>
          )}
        </Card.Body>
      </Card.Root>

      <DashboardWidgetEditDrawer
        open={isDrawerOpen}
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
        activeTab={drawerTab}
        onTabChange={setDrawerTab}
        chart={
          isDrawerOpen ? (
            <SandboxedChartFrame
              key={`${previewCode}\u0000${JSON.stringify(previewQueries)}`}
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
    </Box>
  );
}
