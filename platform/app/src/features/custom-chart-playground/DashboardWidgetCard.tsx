/**
 * One persisted dashboard widget: a grid card showing only its chart —
 * a sandboxed frame, a title, and an edit/delete menu. Its header is the
 * grid's drag handle; its size is dragged from the card's corner. All editing (the
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
 *
 * All of that state lives in `useDashboardWidgetCard`; this file is the card's
 * presentation, split into a header, a preview and the edit drawer.
 */

import { Box, Button, Card, HStack } from "@chakra-ui/react";
import { Clock } from "lucide-react";
import { CHART_GRID_DRAG_HANDLE_CLASS } from "~/components/analytics/reports/ChartGrid";
import { GraphCardMenu } from "~/components/analytics/reports/GraphCardMenu";
import { Menu } from "~/components/ui/menu";
import { chartGridCardHeightPx } from "~/server/analytics/chartGrid";
import type { DashboardWidgetQuery } from "~/server/analytics/dashboardWidgetDefinition";

import { DashboardWidgetEditDrawer } from "./DashboardWidgetEditDrawer";
import { EditableWidgetName } from "./EditableWidgetName";
import { FrameDiagnosticBadge } from "./FrameDiagnosticBadge";
import { SandboxedChartFrame } from "./SandboxedChartFrame";
import {
  type DashboardWidgetCardViewModel,
  RANGE_LABEL,
  RANGE_MS,
  type RangeKey,
  useDashboardWidgetCard,
} from "./useDashboardWidgetCard";

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

/**
 * The height a card's row span grants its frame: the card less its header
 * row and body padding — the same allowance the report grid's cards make.
 */
const CARD_CHROME_PX = 64;
const rowSpanHeight = (rowSpan: number): number =>
  Math.max(chartGridCardHeightPx(rowSpan) - CARD_CHROME_PX, 60);

/** The drawer's own chart preview isn't grid-constrained — a fixed, generous height. */
const DRAWER_PREVIEW_HEIGHT_PX = 320;

// The playground surfaces frame output in the chart itself; no log panel.
const noopLog = () => {
  // Intentionally empty.
};

interface DashboardWidgetCardProps {
  widget: DashboardWidget;
  projectId: string;
  projectSlug: string;
  onDelete: () => void;
  onSave: (
    input: {
      id: string;
      name?: string;
      code: string;
      queries: DashboardWidgetQuery[];
    },
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
  onSave,
  isDeleting,
  isSaving,
}: DashboardWidgetCardProps) {
  const vm = useDashboardWidgetCard({ widget, projectId, projectSlug, onSave });

  return (
    <Box height="full" minWidth={0}>
      <Card.Root
        height="full"
        minWidth={0}
        borderRadius="xl"
        boxShadow="0 1px 2px rgba(16,16,32,0.04)"
      >
        <Card.Body
          height="full"
          display="flex"
          flexDirection="column"
          minWidth={0}
          overflow="hidden"
          paddingX={4}
          paddingTop="10px"
          paddingBottom={3}
          gap={2}
        >
          <CardHeader
            vm={vm}
            widget={widget}
            projectId={projectId}
            projectSlug={projectSlug}
            onDelete={onDelete}
            isDeleting={isDeleting}
          />

          {/* Not rendered while the drawer is open — the drawer mounts its
              own copy of this same frame instead, so there is never more
              than one live iframe (and one LW.query dispatch) running the
              same preview at once. */}
          {!vm.isDrawerOpen && <CardPreview vm={vm} widget={widget} />}
        </Card.Body>
      </Card.Root>

      <CardEditDrawer vm={vm} widget={widget} isSaving={isSaving} />
    </Box>
  );
}

/** The card's drag-handle header: title, session range picker, edit/delete menu. */
function CardHeader({
  vm,
  widget,
  projectId,
  projectSlug,
  onDelete,
  isDeleting,
}: {
  vm: DashboardWidgetCardViewModel;
  widget: DashboardWidget;
  projectId: string;
  projectSlug: string;
  onDelete: () => void;
  isDeleting: boolean;
}) {
  return (
    <HStack
      className={CHART_GRID_DRAG_HANDLE_CLASS}
      minWidth={0}
      cursor="grab"
      _active={{ cursor: "grabbing" }}
      marginBottom={1}
    >
      <Box flex={1} minWidth={0}>
        <EditableWidgetName
          name={widget.name}
          id={widget.id}
          onRename={vm.handleRename}
          fontSize="sm"
          fontWeight="bold"
          truncate
        />
      </Box>

      <Menu.Root>
        <Menu.Trigger asChild>
          <Button variant="ghost" size="xs">
            <Clock /> {RANGE_LABEL[vm.rangeKey]}
          </Button>
        </Menu.Trigger>
        <Menu.Content>
          {(Object.keys(RANGE_MS) as RangeKey[]).map((key) => (
            <Menu.Item
              key={key}
              value={key}
              onClick={() => vm.setRangeKey(key)}
            >
              {RANGE_LABEL[key]}
              {key === vm.rangeKey && " ✓"}
            </Menu.Item>
          ))}
        </Menu.Content>
      </Menu.Root>

      <GraphCardMenu
        graphId={widget.id}
        projectId={projectId}
        projectSlug={projectSlug}
        dashboardId={widget.dashboardId ?? undefined}
        isDashboardWidget
        showAddToDashboard
        onEdit={vm.openCodeTab}
        onDelete={onDelete}
        isDeleting={isDeleting}
      />
    </HStack>
  );
}

/** The card's live chart preview and any diagnostic the frame reports. */
function CardPreview({
  vm,
  widget,
}: {
  vm: DashboardWidgetCardViewModel;
  widget: DashboardWidget;
}) {
  return (
    <Box flex={1} minHeight={0} position="relative">
      <SandboxedChartFrame
        key={`${vm.previewCode}\u0000${JSON.stringify(vm.previewQueries)}`}
        code={vm.previewCode}
        executeQuery={vm.executeQuery}
        dashboardContext={vm.dashboardContext}
        params={vm.paramsSnapshot}
        onLog={vm.onLog}
        onNavigate={vm.onNavigate}
        maxHeight={rowSpanHeight(widget.rowSpan)}
      />
      <FrameDiagnosticBadge diagnostic={vm.diagnostic} />
    </Box>
  );
}

/** The widget's edit drawer, with its own copy of the live preview frame. */
function CardEditDrawer({
  vm,
  widget,
  isSaving,
}: {
  vm: DashboardWidgetCardViewModel;
  widget: DashboardWidget;
  isSaving: boolean;
}) {
  return (
    <DashboardWidgetEditDrawer
      open={vm.isDrawerOpen}
      id={widget.id}
      name={vm.draftName}
      onNameChange={vm.setDraftName}
      code={vm.draftCode}
      queries={vm.draftQueries}
      onCodeChange={vm.setDraftCode}
      onQueriesChange={vm.setDraftQueries}
      lastRuns={vm.lastRuns}
      onRun={vm.runStandalone}
      isDirty={vm.isDirty}
      isSaving={isSaving}
      onClose={vm.handleClose}
      onSave={vm.handleSave}
      activeTab={vm.drawerTab}
      onTabChange={vm.setDrawerTab}
      chart={
        vm.isDrawerOpen ? (
          <SandboxedChartFrame
            key={`${vm.previewCode}\u0000${JSON.stringify(vm.previewQueries)}`}
            code={vm.previewCode}
            executeQuery={vm.executeQuery}
            dashboardContext={vm.dashboardContext}
            params={vm.paramsSnapshot}
            onLog={noopLog}
            onNavigate={vm.onNavigate}
            maxHeight={DRAWER_PREVIEW_HEIGHT_PX}
          />
        ) : null
      }
    />
  );
}
