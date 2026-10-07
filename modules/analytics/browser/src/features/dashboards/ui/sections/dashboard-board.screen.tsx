/**
 * One board: its header, the ask bar, and its stored widgets on the grid, or the
 * blank-board state pointing to the templates library. Every widget is editable; "Add chart"
 * opens the widget drawer, the footer "Add a block" the question picker.
 */

import { Box, Spinner, VStack } from "@chakra-ui/react";
import { UiPageLoading, UiPageNotFound } from "@langwatch/browser/page-fallbacks";
import { HandledErrorAlert } from "@langwatch/error-views";
import { nowInstant } from "@langwatch/time";
import { useState, type ReactNode } from "react";

import { useDashboardAutoRefresh } from "../../../../behavior/use-dashboard-auto-refresh.ts";
import { useAnalyticsHost } from "../../../../model/analytics-host.ts";
import { CreateDashboardWidgetDrawer } from "../../../../ui/sections/create-dashboard-widget-drawer.tsx";
import { DashboardRefreshStatus } from "../../../../ui/sections/dashboard-auto-refresh-menu.tsx";
import { DashboardRefreshedAtContext } from "../../../../ui/sections/use-dashboard-auto-refresh.ts";
import { useBlockPickerAddress } from "../../behavior/use-block-picker-address.ts";
import { useBoardDescription } from "../../behavior/use-board-description.ts";
import { useBoardPeriod } from "../../behavior/use-board-period.ts";
import { useBoardWidgets } from "../../behavior/use-board-widgets.ts";
import { useFavourites } from "../../behavior/use-favourites.ts";
import { type SavedBoard, useSavedDashboards } from "../../behavior/use-saved-dashboards.ts";
import { useLangyAsk } from "../../langy/behavior/use-board-langy.ts";
import {
  boardSubject,
  widgetPromptDraft,
  widgetSetupDraft,
} from "../../langy/model/board-langy.ts";
import { BoardLangy } from "../../langy/ui/sections/board-langy.tsx";
import { dashboardTemplatesPath } from "../../model/boards.ts";
import { AddBlockCard, BlankBoard } from "../blocks/blank-board.tsx";
import { BoardHeader } from "../blocks/board-header.tsx";
import { BoardPeriodControl } from "../blocks/board-period-control.tsx";
import { BlockPickerDialog } from "./block-picker-dialog.tsx";
import { BoardWidgetsGrid } from "./board-widgets-grid.tsx";
import { DashboardsGate } from "./dashboards-gate.tsx";

function BoardPage({ header, children }: { header: ReactNode; children: ReactNode }) {
  // A wide screen keeps its full content width, up to a readable cap.
  return (
    <VStack
      align="stretch"
      gap={0}
      width="full"
      maxWidth="1440px"
      marginX="auto"
      paddingX={8}
      paddingY={6}
      lineHeight="1.45"
    >
      {header}
      <Box as="section" aria-label="Widgets" minHeight="240px">
        {children}
      </Box>
    </VStack>
  );
}

function OpenBoard({ board }: { board: SavedBoard }) {
  const host = useAnalyticsHost();
  const projectId = host.project()?.id ?? "";
  const saved = useSavedDashboards();
  const boardWidgets = useBoardWidgets();
  const { description, saveDescription } = useBoardDescription({
    dashboardId: board.id,
    stored: board.description,
  });
  const favourites = useFavourites();
  const { range, grain, period, setRange, setGrain } = useBoardPeriod();
  const picker = useBlockPickerAddress();
  const [isAddChartOpen, setIsAddChartOpen] = useState(false);
  const [openedAt] = useState(() => nowInstant().epochMilliseconds);
  const widgets = boardWidgets.widgetsOn(board.id);
  const subject = boardSubject({ board, widgets });
  const langy = useLangyAsk();
  const autoRefresh = useDashboardAutoRefresh({ live: range === "live" });

  return (
    <BoardPage
      header={
        <BoardHeader
          name={board.name}
          description={description}
          isStarred={board.isStarred}
          onToggleStar={() =>
            favourites.toggleStar({ dashboardId: board.id, isStarred: board.isStarred })
          }
          onRename={(name) => saved.renameBoard({ dashboardId: board.id, name })}
          onDescribe={saveDescription}
          onAddChart={() => setIsAddChartOpen(true)}
          periodControl={
            <BoardPeriodControl
              range={range}
              grain={grain}
              refresh={autoRefresh.option}
              onRangeChange={setRange}
              onGrainChange={setGrain}
              onRefreshChange={autoRefresh.setOption}
            />
          }
          refreshControl={
            <DashboardRefreshStatus
              refreshedAt={autoRefresh.refreshedAt ?? openedAt}
              onRefreshNow={autoRefresh.refreshNow}
            />
          }
        />
      }
    >
      <BoardLangy onOpenPicker={picker.open} />
      {boardWidgets.status === "pending" && <Spinner size="sm" />}
      {boardWidgets.status === "error" && (
        <HandledErrorAlert
          error={boardWidgets.error}
          fallbackTitle="This dashboard could not load its widgets"
        />
      )}
      {boardWidgets.status === "success" && widgets.length === 0 && (
        <BlankBoard templatesHref={dashboardTemplatesPath({ projectSlug: saved.projectSlug })} />
      )}
      {boardWidgets.status === "success" && widgets.length > 0 && (
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
            <AddBlockCard onClick={picker.open} />
          </VStack>
        </DashboardRefreshedAtContext.Provider>
      )}
      {picker.isOpen && (
        <BlockPickerDialog
          board={subject}
          period={period}
          onAddWidgets={(question) =>
            boardWidgets.addQuestionWidgets({ dashboardId: board.id, question })
          }
          onClose={picker.close}
        />
      )}
      <CreateDashboardWidgetDrawer
        open={isAddChartOpen}
        onClose={() => setIsAddChartOpen(false)}
        projectId={projectId}
        projectSlug={saved.projectSlug}
        dashboardId={board.id}
      />
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
