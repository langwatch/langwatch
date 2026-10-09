/**
 * One stored board: its header with its scope, the ask bar, its widgets or the one empty board
 * view, and its one widget editor, opened from the picker that "Add a widget" and the ask bar
 * open. A reader who cannot edit the board gets it view-only; their copy is the sidebar's to make.
 * @see modules/dashboard/specs/dashboards-v2.feature and dashboards-widget-flow.feature
 */

import { UiPageLoading, UiPageNotFound } from "@langwatch/browser/page-fallbacks";
import { Button, Spinner, Text, VStack } from "@langwatch/design-system/primitives";
import { HandledErrorAlert } from "@langwatch/error-views";
import { Plus } from "lucide-react";

import {
  DashboardRefetchIntervalContext,
  useDashboardAutoRefresh,
} from "../../../../behavior/use-dashboard-auto-refresh.ts";
import { useAnalyticsHost } from "../../../../model/analytics-host.ts";
import type { DashboardWidgetDraft } from "../../../../model/dashboard-widget-draft.ts";
import { DashboardRefreshedAtContext } from "../../../../ui/sections/use-dashboard-auto-refresh.ts";
import {
  useBlockPickerAddress,
  WIDGET_PICKER_QUERY_KEY,
} from "../../behavior/use-block-picker-address.ts";
import { useBoardAccess } from "../../behavior/use-board-access.ts";
import { useBoardDescription } from "../../behavior/use-board-description.ts";
import { useBoardEditor } from "../../behavior/use-board-editor.ts";
import { useBoardPeriod } from "../../behavior/use-board-period.ts";
import { useBoardProjects } from "../../behavior/use-board-projects.ts";
import { useBoardScope } from "../../behavior/use-board-scope.ts";
import { useBoardWidgets } from "../../behavior/use-board-widgets.ts";
import { type SavedBoard, useSavedDashboards } from "../../behavior/use-saved-dashboards.ts";
import { useLangyAsk } from "../../langy/behavior/use-board-langy.ts";
import {
  boardSubject,
  widgetMissingDataDraft,
  widgetPromptDraft,
  widgetSetupDraft,
} from "../../langy/model/board-langy.ts";
import { BoardLangy } from "../../langy/ui/sections/board-langy.tsx";
import { curatedBoardPath, dashboardTemplatesPath, myDashboardId } from "../../model/boards.ts";
import { CURATED_BOARDS } from "../../model/curated-boards.ts";
import { AddBlockCard, EmptyBoard } from "../blocks/blank-board.tsx";
import { BoardHeader } from "../blocks/board-header.tsx";
import { BoardPage } from "../blocks/board-page.tsx";
import { BoardPeriodControl } from "../blocks/board-period-control.tsx";
import { BoardProjectChip } from "../blocks/board-project-chip.tsx";
import { BoardScopeControl } from "../blocks/board-scope-control.tsx";
import { BoardUnavailable } from "../blocks/board-unavailable.tsx";
import { ScopeConfirmDialog } from "../blocks/scope-confirm-dialog.tsx";
import { BlockPickerDialog } from "./block-picker-dialog.tsx";
import { BoardWidgetEditor } from "./board-widget-editor.tsx";
import { BoardWidgetsGrid } from "./board-widgets-grid.tsx";
import { DashboardsGate } from "./dashboards-gate.tsx";

/** The header's one action on a board the reader may edit. */
function AddWidgetButton({ onClick }: { onClick: () => void }) {
  return (
    <Button
      variant="outline"
      height={8}
      paddingX={3}
      gap={1.5}
      borderRadius="lg"
      borderColor="border"
      fontSize="13px"
      fontWeight="medium"
      _hover={{ borderColor: "border.emphasized", background: "bg.muted" }}
      onClick={onClick}
    >
      <Plus size={15} strokeWidth={2} /> Add a widget
    </Button>
  );
}

function OpenBoard({ board }: { board: SavedBoard }) {
  const host = useAnalyticsHost();
  const projectId = host.project()?.id ?? "";
  const saved = useSavedDashboards();
  const { access, names } = useBoardAccess(board);
  const { canEdit } = access;
  const scope = useBoardScope();
  const projects = useBoardProjects({ board });
  const boardWidgets = useBoardWidgets({
    dashboardId: board.id,
    isOwnedElsewhere: !access.isHome,
  });
  const { description, saveDescription } = useBoardDescription({
    dashboardId: board.id,
    stored: board.description,
  });
  const { range, grain, period, setRange, setGrain } = useBoardPeriod();
  const picker = useBlockPickerAddress();
  // What the ask bar had typed when it opened the picker, as the picker's first search.
  const { widgets } = boardWidgets;
  const subject = boardSubject({ board, widgets });
  const langy = useLangyAsk();
  const editor = useBoardEditor({ board: subject, period, widgets });
  const autoRefresh = useDashboardAutoRefresh({ live: range === "live" });

  const openPicker = () => {
    if (!picker.isOpen) picker.open();
  };
  /** Saves the editor's widget, a new one or an edit, and closes it once that landed. */
  const saveEdited = async (edited: DashboardWidgetDraft) => {
    const widget = editor.editing?.widget;
    const landed = widget
      ? await boardWidgets.saveWidget({ widget, draft: edited })
      : await boardWidgets.addWidget(edited);
    if (landed) editor.close();
  };
  const isEmpty = boardWidgets.status === "success" && widgets.length === 0;
  const isMyDashboard = myDashboardId({ boards: [board], userId: host.userId() }) === board.id;

  return (
    <BoardPage
      header={
        <BoardHeader
          name={board.name}
          description={description}
          scope={
            <BoardScopeControl
              scope={board.scope}
              lock={access.scopeLock}
              names={names}
              onPick={(to) => scope.request({ board, names, to })}
            />
          }
          onDescribe={canEdit && !isMyDashboard ? saveDescription : void 0}
          action={canEdit ? <AddWidgetButton onClick={openPicker} /> : null}
          {...(projects.isShared
            ? {
                project: (
                  <BoardProjectChip
                    current={projects.current}
                    ownerProject={projects.ownerProject}
                    projects={projects.projects}
                    onPick={projects.openIn}
                  />
                ),
              }
            : {})}
          periodControl={
            <BoardPeriodControl
              range={range}
              grain={grain}
              refresh={autoRefresh.option}
              onRangeChange={setRange}
              onGrainChange={setGrain}
              onRefreshChange={autoRefresh.setOption}
              onRefreshNow={autoRefresh.refreshNow}
            />
          }
        />
      }
    >
      <BoardLangy
        board={subject}
        period={period}
        withSuggestions={isEmpty && canEdit}
        {...(canEdit ? { onOpenPicker: openPicker } : {})}
      />
      {boardWidgets.status === "pending" && <Spinner size="sm" />}
      {boardWidgets.status === "error" && (
        <HandledErrorAlert
          error={boardWidgets.error}
          fallbackTitle="This dashboard could not load its widgets"
        />
      )}
      {isEmpty && !canEdit && (
        <Text fontSize="13px" color="fg.muted">
          This dashboard has no widgets yet.
        </Text>
      )}
      {isEmpty && canEdit && (
        <EmptyBoard
          boards={CURATED_BOARDS}
          boardHref={({ templateId }) =>
            curatedBoardPath({ projectSlug: saved.projectSlug, templateId })
          }
          templatesHref={dashboardTemplatesPath({ projectSlug: saved.projectSlug })}
        />
      )}
      {boardWidgets.status === "success" && widgets.length > 0 && (
        <DashboardRefetchIntervalContext.Provider value={autoRefresh.refetchInterval}>
          <DashboardRefreshedAtContext.Provider value={autoRefresh.refreshedAt}>
            <VStack align="stretch" gap={4}>
              <BoardWidgetsGrid
                projectId={projectId}
                projectSlug={saved.projectSlug}
                dashboardId={board.id}
                widgets={widgets}
                period={period}
                isWriting={boardWidgets.isWriting}
                langyFor={
                  langy.enabled
                    ? (widget) => ({
                        ask: () => langy.ask(widgetPromptDraft({ widget, board: subject, period })),
                        setUp: (setup) =>
                          langy.ask(widgetSetupDraft({ setup, widget, board: subject, period })),
                        setUpMissing: (missing) =>
                          langy.ask(
                            widgetMissingDataDraft({ missing, widget, board: subject, period }),
                          ),
                      })
                    : undefined
                }
                {...(canEdit
                  ? {
                      onEdit: editor.open,
                      onDuplicate: (widget) => void boardWidgets.duplicateWidget(widget),
                      onDelete: (widget) => void boardWidgets.removeWidget(widget),
                      onPlacementsCommit: (placements) =>
                        void boardWidgets.commitPlacements(placements),
                    }
                  : {})}
              />
              {canEdit && <AddBlockCard onClick={() => openPicker()} />}
            </VStack>
          </DashboardRefreshedAtContext.Provider>
        </DashboardRefetchIntervalContext.Provider>
      )}
      {canEdit && picker.isOpen && (
        <BlockPickerDialog
          board={subject}
          period={period}
          onAddWidgets={boardWidgets.addQuestionWidgets}
          onSkip={() => {
            editor.open({ widget: null, withLangy: false, closing: [WIDGET_PICKER_QUERY_KEY] });
          }}
          onClose={picker.close}
        />
      )}
      {canEdit && editor.editing && (
        <BoardWidgetEditor
          key={editor.editing.widget?.id ?? "new"}
          widget={editor.editing.widget}
          projectId={projectId}
          projectSlug={saved.projectSlug}
          dashboardId={board.id}
          period={period}
          isSaving={boardWidgets.isSaving}
          {...(editor.asks ? { asks: editor.asks } : {})}
          onAsk={editor.ask}
          onClose={editor.close}
          onSave={(edited) => void saveEdited(edited)}
        />
      )}
      <ScopeConfirmDialog
        words={scope.asking}
        isChanging={scope.isChanging}
        onConfirm={scope.confirm}
        onCancel={scope.cancel}
      />
    </BoardPage>
  );
}

function Board() {
  const dashboardId = useAnalyticsHost().route().params.dashboardId;
  const { boards, organizationBoards, isLoading, loadError } = useSavedDashboards();
  if (isLoading) return <UiPageLoading />;
  // A member the list refuses sees the page the flag being off shows (AC21).
  if (loadError) return <UiPageNotFound />;
  const board = [...boards, ...organizationBoards].find(({ id }) => id === dashboardId);
  // A deleted board and one set to Only me read the same: the server tells neither apart.
  if (!board) return <BoardUnavailable />;
  // Keyed so a board's in-flight edits never leak into the next board.
  return <OpenBoard key={board.id} board={board} />;
}

export default function DashboardBoardScreen() {
  return (
    <DashboardsGate>
      <Board />
    </DashboardsGate>
  );
}
