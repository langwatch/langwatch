/**
 * One stored board: its header with its scope, the ask bar, its widgets or the one empty board
 * view, and its one widget editor, opened from the picker that "Add a widget" and the ask bar
 * open. A reader who cannot edit the board gets it view-only; their copy is the sidebar's to make.
 * @see modules/dashboard/specs/dashboards-v2.feature and dashboards-widget-flow.feature
 */

import { UiPageLoading, UiPageNotFound } from "@langwatch/browser/page-fallbacks";
import type { DashboardHomeProduct } from "@langwatch/dashboard-contract";
import { Button, Spinner, Text, VStack } from "@langwatch/design-system/primitives";
import { HandledErrorAlert } from "@langwatch/error-views";
import { Plus } from "lucide-react";
import { useEffect } from "react";

import {
  DashboardRefetchIntervalContext,
  useDashboardAutoRefresh,
} from "../../../../behavior/use-dashboard-auto-refresh.ts";
import { useAnalyticsHost } from "../../../../model/analytics-host.ts";
import type { DashboardWidgetDraft } from "../../../../model/dashboard-widget-draft.ts";
import { DashboardRefreshedAtContext } from "../../../../ui/sections/use-dashboard-auto-refresh.ts";
import { WidgetReadsEveryProjectContext } from "../../../dashboard-widget/behavior/use-dashboard-widget-executor.ts";
import {
  useBlockPickerAddress,
  WIDGET_PICKER_QUERY_KEY,
} from "../../behavior/use-block-picker-address.ts";
import { useBoardAccess } from "../../behavior/use-board-access.ts";
import { useBoardEditor } from "../../behavior/use-board-editor.ts";
import { type UnsavedBoard, useBoardHeaderEdits } from "../../behavior/use-board-header-edits.ts";
import { useBoardPeriod, useBoardRange } from "../../behavior/use-board-period.ts";
import { useBoardScope } from "../../behavior/use-board-scope.ts";
import { useBoardWidgets } from "../../behavior/use-board-widgets.ts";
import { useDashboardViewed } from "../../behavior/use-dashboard-viewed.ts";
import { restartStoredDraft, useDraftBoard } from "../../behavior/use-draft-board.ts";
import { useEmptyWidgets } from "../../behavior/use-empty-widgets.ts";
import { useLibraryBoardEdits } from "../../behavior/use-library-board-edits.ts";
import { useLimitFailedWidgets } from "../../behavior/use-limit-failed-widgets.ts";
import { type SavedBoard, useSavedDashboards } from "../../behavior/use-saved-dashboards.ts";
import {
  UnsavedBoardProvider,
  useBoardLangyChip,
  useLangyAsk,
} from "../../langy/behavior/use-board-langy.ts";
import {
  boardContextChip,
  boardSetupDraft,
  boardSubject,
  widgetActionDraft,
  widgetChartDraft,
  widgetMissingDataDraft,
  widgetPromptDraft,
  widgetSetupDraft,
} from "../../langy/model/board-langy.ts";
import { BoardLangy } from "../../langy/ui/sections/board-langy.tsx";
import { DRAFT_SEGMENT, myDashboardId, templateLinks } from "../../model/boards.ts";
import { CURATED_BOARDS } from "../../model/curated-boards.ts";
import { mayRenameBoard } from "../../model/organization-library.ts";
import { AddBlockCard, EmptyBoard } from "../blocks/blank-board.tsx";
import { BoardDataSourceLabel } from "../blocks/board-data-source-label.tsx";
import { BoardHeader } from "../blocks/board-header.tsx";
import { BoardPage } from "../blocks/board-page.tsx";
import { BoardPeriodControl } from "../blocks/board-period-control.tsx";
import { BoardScopeControl } from "../blocks/board-scope-control.tsx";
import { EmptyWidgetsBanner } from "../blocks/empty-widgets-banner.tsx";
import { LimitFailedWidgetsBanner } from "../blocks/limit-failed-widgets-banner.tsx";
import { OldAnalyticsBanner } from "../blocks/old-analytics-banner.tsx";
import { ScopeConfirmDialog } from "../blocks/scope-confirm-dialog.tsx";
import { BlockPickerDialog } from "./block-picker-dialog.tsx";
import { BoardWidgetEditor } from "./board-widget-editor.tsx";
import { BoardWidgetsGrid } from "./board-widgets-grid.tsx";
import { DashboardsGate } from "./dashboards-gate.tsx";
import { ProjectBoardUnavailable } from "./project-board-unavailable.tsx";

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
      textStyle="label"
      fontWeight="medium"
      _hover={{ borderColor: "border.emphasized", background: "bg.muted" }}
      onClick={onClick}
    >
      <Plus size={15} strokeWidth={2} /> Add a widget
    </Button>
  );
}

/** A Gateway or Governance board reads the organization's data, not a project's (ADR-002, D2). */
const ORGANIZATION_DATA_HOMES: readonly DashboardHomeProduct[] = ["gateway", "governance"];

/** The header's read-only "Data from <project>"; a board reading the organization names none. */
function dataSourceLabel({
  readsOrganization,
  projectName,
}: {
  readsOrganization: boolean;
  projectName: string | undefined;
}) {
  if (readsOrganization || !projectName) return {};
  return { project: <BoardDataSourceLabel name={projectName} /> };
}

/** Renames from the title, or undefined where the reader may not: asked in the project that
 * owns the board, as the library and sidebar menus ask it. */
function useBoardTitleRename({
  board,
  unsaved,
}: {
  board: SavedBoard;
  unsaved: UnsavedBoard | undefined;
}): ((name: string) => void) | undefined {
  const host = useAnalyticsHost();
  const edits = useLibraryBoardEdits();
  const mayRename = mayRenameBoard({
    board,
    userId: host.userId(),
    mayEditInOwner: host.hasPermissionIn({
      projectId: board.projectId,
      permission: "analytics:update",
    }),
  });
  if (!mayRename) return void 0;
  // A draft's new name is its first edit: it stores the board under that name.
  if (unsaved) {
    return (name) =>
      void unsaved.materialise({ name }).catch((error: unknown) => {
        host.failed({ error, fallbackTitle: "Couldn't save the dashboard" });
      });
  }
  return (name) =>
    edits.renameBoard({ board: { ...board, project: { id: board.projectId } }, name });
}

/** What the header's lent actions point at; a board not stored yet offers none. */
function boardPointer({
  board,
  unsaved,
  boardWidgets: { status, widgets },
}: {
  board: SavedBoard;
  unsaved: UnsavedBoard | undefined;
  boardWidgets: ReturnType<typeof useBoardWidgets>;
}) {
  if (unsaved) return {};
  const widgetCount = status === "success" ? widgets.length : void 0;
  return { pointer: { boardKind: "dashboard" as const, boardId: board.id, widgetCount } };
}

/** On a new board, Langy's asks store it first and then name the stored board. */
function unsavedLangy(unsaved: UnsavedBoard | undefined) {
  return unsaved && { draftId: DRAFT_SEGMENT, storedBoardId: unsaved.materialise };
}

function OpenBoard({ board, unsaved }: { board: SavedBoard; unsaved?: UnsavedBoard }) {
  const host = useAnalyticsHost();
  const readsOrganization = ORGANIZATION_DATA_HOMES.includes(board.homeProduct);
  const projectId = host.project()?.id ?? "";
  const saved = useSavedDashboards();
  const { access, names } = useBoardAccess(board);
  const { canEdit } = access;
  const scope = useBoardScope();
  const boardWidgets = useBoardWidgets({
    dashboardId: board.id,
    isOwnedElsewhere: !access.isHome,
    storedBoardId: unsaved?.materialise,
  });
  const { description, saveDescription, pickScope } = useBoardHeaderEdits({
    board,
    unsaved,
    names,
    scope,
  });
  const { range } = useBoardRange();
  const autoRefresh = useDashboardAutoRefresh({ live: range === "live" });
  const { grain, period, setRange, setGrain } = useBoardPeriod({
    refreshedAt: autoRefresh.refreshedAt,
  });
  const picker = useBlockPickerAddress();
  // What the ask bar had typed when it opened the picker, as the picker's first search.
  const { widgets } = boardWidgets;
  useDashboardViewed({
    dashboardId: board.id,
    dashboardKind: "stored",
    widgetCount: widgets.length,
    // A new board is viewed once stored; a draft nobody edits was never a dashboard.
    isLoaded: boardWidgets.status === "success" && !unsaved,
  });
  const subject = boardSubject({ board, widgets });
  const langy = useLangyAsk();
  useBoardLangyChip(boardContextChip({ board: subject, range, period }));
  const editor = useBoardEditor({ board: subject, period, widgets });
  const empty = useEmptyWidgets();
  const emptyWidgetNames = empty.emptyNames({ widgets, keyOf: ({ id }) => id });
  const limitFailedWidgets = useLimitFailedWidgets();
  const askLangyToSetUp = langy.enabled
    ? () => langy.ask(boardSetupDraft({ emptyWidgetNames, board: subject, period }))
    : undefined;

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
  const renameBoard = useBoardTitleRename({ board, unsaved });
  const templates = templateLinks({
    projectSlug: saved.projectSlug,
    homeProduct: board.homeProduct,
  });

  return (
    <WidgetReadsEveryProjectContext.Provider value={readsOrganization}>
      <UnsavedBoardProvider value={unsavedLangy(unsaved)}>
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
                  onPick={pickScope}
                />
              }
              onRename={renameBoard}
              onDescribe={canEdit && !isMyDashboard ? saveDescription : void 0}
              {...boardPointer({ board, unsaved, boardWidgets })}
              action={canEdit ? <AddWidgetButton onClick={openPicker} /> : null}
              {...dataSourceLabel({ readsOrganization, projectName: host.project()?.name })}
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
            <Text textStyle="bodySm" color="fg.muted">
              This dashboard has no widgets yet.
            </Text>
          )}
          {isEmpty && canEdit && templates && (
            <EmptyBoard
              boards={CURATED_BOARDS}
              boardHref={({ templateId }) => templates.curatedHref(templateId)}
              templatesHref={templates.templatesHref}
            />
          )}
          {boardWidgets.status === "success" && widgets.length > 0 && (
            <DashboardRefetchIntervalContext.Provider value={autoRefresh.refetchInterval}>
              <DashboardRefreshedAtContext.Provider value={autoRefresh.refreshedAt}>
                <VStack align="stretch" gap={4}>
                  <EmptyWidgetsBanner
                    emptyWidgetNames={emptyWidgetNames}
                    onAskLangy={askLangyToSetUp}
                  />
                  <LimitFailedWidgetsBanner
                    failed={limitFailedWidgets.count({ widgets, keyOf: ({ id }) => id })}
                    total={widgets.length}
                  />
                  <BoardWidgetsGrid
                    projectId={projectId}
                    projectSlug={saved.projectSlug}
                    dashboardId={board.id}
                    boardName={board.name}
                    widgets={widgets}
                    period={period}
                    periodKey={`${range}:${grain}`}
                    isWriting={boardWidgets.isWriting}
                    onEmptyChange={({ widget, empty: showsNoData }) =>
                      empty.report({ key: widget.id, empty: showsNoData })
                    }
                    onLimitFailureChange={({ widget, limited }) =>
                      limitFailedWidgets.report({ key: widget.id, limited })
                    }
                    langyFor={
                      langy.enabled
                        ? (widget) => ({
                            ask: () =>
                              langy.ask(widgetPromptDraft({ widget, board: subject, period })),
                            setUp: (setup) =>
                              langy.ask(
                                widgetSetupDraft({ setup, widget, board: subject, period }),
                              ),
                            setUpMissing: (missing) =>
                              langy.ask(
                                widgetMissingDataDraft({ missing, widget, board: subject, period }),
                              ),
                            askAbout: (about) =>
                              langy.ask(
                                widgetChartDraft({
                                  subject: about,
                                  widget,
                                  board: subject,
                                  period,
                                }),
                              ),
                            act: (action) =>
                              langy.ask(
                                widgetActionDraft({ action, widget, board: subject, period }),
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
      </UnsavedBoardProvider>
    </WidgetReadsEveryProjectContext.Provider>
  );
}

/** The board the address names, in the project in view; the org-level page runs it too. */
export function Board() {
  const host = useAnalyticsHost();
  const projectId = host.project()?.id ?? "";
  const dashboardId = host.route().params.dashboardId;
  const { boards, organizationBoards, isLoading, isRefreshing, loadError } = useSavedDashboards();
  const draft = useDraftBoard({ existingCount: boards.length });
  const isDraft = dashboardId === DRAFT_SEGMENT;
  useEffect(() => {
    if (isDraft) restartStoredDraft(projectId);
  }, [isDraft, projectId]);
  if (isLoading) return <UiPageLoading />;
  // A member the list refuses sees the page the flag being off shows (AC21).
  if (loadError) return <UiPageNotFound />;
  if (isDraft) {
    return <OpenBoard key={draft.key} board={draft.board} unsaved={draft} />;
  }
  const board = [...boards, ...organizationBoards].find(({ id }) => id === dashboardId);
  // A board made a moment ago is missing from the list held before it; wait for the re-read.
  if (!board && isRefreshing) return <UiPageLoading />;
  // A deleted board and one set to Only me read the same: the server tells neither apart.
  if (!board) return <ProjectBoardUnavailable />;
  // Keyed so a board's in-flight edits never leak into the next board; a draft just stored
  // keeps its key, so the screen stays as it was while its address moves to the board's.
  return (
    <>
      {/* Only the board the Analytics entry lands on points back to it (AC3i, AC3t). */}
      {board.id === myDashboardId({ boards, userId: host.userId() }) && <OldAnalyticsBanner />}
      <OpenBoard key={board.id === draft.savedId ? draft.key : board.id} board={board} />
    </>
  );
}

export default function DashboardBoardScreen() {
  return (
    <DashboardsGate>
      <Board />
    </DashboardsGate>
  );
}
