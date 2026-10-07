/**
 * One stored board: its header, the ask bar, and its widgets on the grid, or the one empty
 * board view (the ask bar with suggested questions, then "Or start from a template"). Every
 * widget is editable; "Add a widget", the footer and typing in the ask bar open the picker.
 * @see modules/dashboard/specs/dashboards-v2.feature
 */

import { UiPageLoading, UiPageNotFound } from "@langwatch/browser/page-fallbacks";
import { Button, Spinner, VStack } from "@langwatch/design-system/primitives";
import { HandledErrorAlert } from "@langwatch/error-views";
import { Plus } from "lucide-react";
import { useState } from "react";

import {
  DashboardRefetchIntervalContext,
  useDashboardAutoRefresh,
} from "../../../../behavior/use-dashboard-auto-refresh.ts";
import { useAnalyticsHost } from "../../../../model/analytics-host.ts";
import { DashboardRefreshedAtContext } from "../../../../ui/sections/use-dashboard-auto-refresh.ts";
import { useBlockPickerAddress } from "../../behavior/use-block-picker-address.ts";
import { useBoardDescription } from "../../behavior/use-board-description.ts";
import { useBoardPeriod } from "../../behavior/use-board-period.ts";
import { useBoardWidgets } from "../../behavior/use-board-widgets.ts";
import { type SavedBoard, useSavedDashboards } from "../../behavior/use-saved-dashboards.ts";
import { useBoardOnScreen, useLangyAsk } from "../../langy/behavior/use-board-langy.ts";
import {
  boardSubject,
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
import { BlockPickerDialog } from "./block-picker-dialog.tsx";
import { BoardWidgetsGrid } from "./board-widgets-grid.tsx";
import { DashboardsGate } from "./dashboards-gate.tsx";

function OpenBoard({ board }: { board: SavedBoard }) {
  const host = useAnalyticsHost();
  const projectId = host.project()?.id ?? "";
  const saved = useSavedDashboards();
  const boardWidgets = useBoardWidgets();
  const { description, saveDescription } = useBoardDescription({
    dashboardId: board.id,
    stored: board.description,
  });
  const { range, grain, period, setRange, setGrain } = useBoardPeriod();
  const picker = useBlockPickerAddress();
  // What the ask bar had typed when it opened the picker, as the picker's first search.
  const [pickerSearch, setPickerSearch] = useState("");
  const widgets = boardWidgets.widgetsOn(board.id);
  const subject = boardSubject({ board, widgets });
  const langy = useLangyAsk();
  const autoRefresh = useDashboardAutoRefresh({ live: range === "live" });
  useBoardOnScreen(board.id);

  const openPicker = (search = "") => {
    setPickerSearch(search);
    if (!picker.isOpen) picker.open();
  };
  const isEmpty = boardWidgets.status === "success" && widgets.length === 0;
  const isMyDashboard = myDashboardId({ boards: [board], userId: host.userId() }) === board.id;

  return (
    <BoardPage
      header={
        <BoardHeader
          name={board.name}
          description={description}
          onDescribe={isMyDashboard ? void 0 : saveDescription}
          action={
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
              onClick={() => openPicker()}
            >
              <Plus size={15} strokeWidth={2} /> Add a widget
            </Button>
          }
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
        withSuggestions={isEmpty}
        onOpenPicker={openPicker}
      />
      {boardWidgets.status === "pending" && <Spinner size="sm" />}
      {boardWidgets.status === "error" && (
        <HandledErrorAlert
          error={boardWidgets.error}
          fallbackTitle="This dashboard could not load its widgets"
        />
      )}
      {isEmpty && (
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
                isSaving={boardWidgets.isSaving}
                onDuplicate={(widget) =>
                  void boardWidgets.duplicateWidget({ dashboardId: board.id, widget })
                }
                onDelete={(widget) => void boardWidgets.removeWidget({ widget })}
                onSave={({ widget, draft, onSaved }) =>
                  void boardWidgets.saveWidget({ widgetId: widget.id, draft, onSaved })
                }
                onPlacementsCommit={(placements) => void boardWidgets.commitPlacements(placements)}
                onAskLangy={
                  langy.enabled
                    ? (widget) => langy.ask(widgetPromptDraft({ widget, board: subject, period }))
                    : undefined
                }
                onSetUp={
                  langy.enabled
                    ? ({ widget, setup }) =>
                        langy.ask(widgetSetupDraft({ setup, widget, board: subject, period }))
                    : undefined
                }
              />
              <AddBlockCard onClick={() => openPicker()} />
            </VStack>
          </DashboardRefreshedAtContext.Provider>
        </DashboardRefetchIntervalContext.Provider>
      )}
      {picker.isOpen && (
        <BlockPickerDialog
          board={subject}
          period={period}
          initialSearch={pickerSearch}
          onAddWidgets={(question) =>
            boardWidgets.addQuestionWidgets({ dashboardId: board.id, question })
          }
          onClose={() => {
            setPickerSearch("");
            picker.close();
          }}
        />
      )}
    </BoardPage>
  );
}

function Board() {
  const dashboardId = useAnalyticsHost().route().params.dashboardId;
  const { boards, isLoading } = useSavedDashboards();
  if (isLoading) return <UiPageLoading />;
  const board = boards.find(({ id }) => id === dashboardId);
  if (!board) return <UiPageNotFound />;
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
