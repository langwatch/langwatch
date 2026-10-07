/**
 * `/[project]/dashboards/curated/[templateId]`: a From LangWatch board, a template live and
 * read-only. Nothing is stored until "Duplicate to edit" (dashboards-v2.feature).
 */

import { UiPageNotFound } from "@langwatch/browser/page-fallbacks";
import { Button } from "@langwatch/design-system/primitives";

import {
  DashboardRefetchIntervalContext,
  useDashboardAutoRefresh,
} from "../../../../behavior/use-dashboard-auto-refresh.ts";
import { useAnalyticsHost } from "../../../../model/analytics-host.ts";
import { DashboardRefreshedAtContext } from "../../../../ui/sections/use-dashboard-auto-refresh.ts";
import { useBoardPeriod } from "../../behavior/use-board-period.ts";
import { useDuplicateCurated } from "../../behavior/use-duplicate-curated.ts";
import { useSavedDashboards } from "../../behavior/use-saved-dashboards.ts";
import { useBoardOnScreen } from "../../langy/behavior/use-board-langy.ts";
import { boardSubject } from "../../langy/model/board-langy.ts";
import { BoardLangy } from "../../langy/ui/sections/board-langy.tsx";
import { CURATED_SEGMENT } from "../../model/boards.ts";
import { type CuratedBoard, curatedBoardById } from "../../model/curated-boards.ts";
import { BoardHeader } from "../blocks/board-header.tsx";
import { BoardPage } from "../blocks/board-page.tsx";
import { BoardPeriodControl } from "../blocks/board-period-control.tsx";
import { CuratedWidgetsGrid } from "./curated-widgets-grid.tsx";
import { DashboardsGate } from "./dashboards-gate.tsx";

function OpenCuratedBoard({ board }: { board: CuratedBoard }) {
  const host = useAnalyticsHost();
  const projectId = host.project()?.id ?? "";
  const saved = useSavedDashboards();
  const copy = useDuplicateCurated();
  const { range, grain, period, setRange, setGrain } = useBoardPeriod();
  const autoRefresh = useDashboardAutoRefresh({ live: range === "live" });
  const subject = boardSubject({
    board: {
      id: `${CURATED_SEGMENT}/${board.templateId}`,
      name: board.name,
      templateId: board.templateId,
    },
    widgets: board.widgets.map((widget) =>
      widget.kind === "built" ? widget.widget : { name: widget.name },
    ),
  });
  useBoardOnScreen(subject.id);

  return (
    <BoardPage
      header={
        <BoardHeader
          name={board.name}
          description={board.job}
          isFromLangWatch
          action={
            <Button
              size="sm"
              colorPalette="teal"
              borderRadius="lg"
              fontSize="13px"
              loading={copy.creatingId === board.templateId}
              onClick={() => void copy.duplicate(board)}
            >
              Duplicate to edit
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
      <BoardLangy board={subject} period={period} />
      <DashboardRefetchIntervalContext.Provider value={autoRefresh.refetchInterval}>
        <DashboardRefreshedAtContext.Provider value={autoRefresh.refreshedAt}>
          <CuratedWidgetsGrid
            projectId={projectId}
            projectSlug={saved.projectSlug}
            templateId={board.templateId}
            widgets={board.widgets}
            period={period}
          />
        </DashboardRefreshedAtContext.Provider>
      </DashboardRefetchIntervalContext.Provider>
    </BoardPage>
  );
}

function Curated() {
  const templateId = useAnalyticsHost().route().params.templateId ?? "";
  const board = curatedBoardById(templateId);
  if (!board) return <UiPageNotFound />;
  return <OpenCuratedBoard key={board.templateId} board={board} />;
}

export default function CuratedBoardScreen() {
  return (
    <DashboardsGate>
      <Curated />
    </DashboardsGate>
  );
}
