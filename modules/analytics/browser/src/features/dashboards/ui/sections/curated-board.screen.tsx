/**
 * `/<project>/dashboards/curated/<templateId>`: a From LangWatch board, a template live and stored
 * nowhere. A member who may make boards gets every edit; the first asks, then makes their own copy
 * (dashboards-v2.feature). `organization-curated.screen.tsx` opens it at the organization level.
 */

import { UiPageNotFound } from "@langwatch/browser/page-fallbacks";
import { Button, VStack } from "@langwatch/design-system/primitives";
import { LayoutTemplate } from "lucide-react";

import {
  DashboardRefetchIntervalContext,
  useDashboardAutoRefresh,
} from "../../../../behavior/use-dashboard-auto-refresh.ts";
import { useAnalyticsHost } from "../../../../model/analytics-host.ts";
import { DashboardRefreshedAtContext } from "../../../../ui/sections/use-dashboard-auto-refresh.ts";
import { useAddTemplate } from "../../behavior/use-add-template.ts";
import { useBlockPickerAddress } from "../../behavior/use-block-picker-address.ts";
import { useBoardReader } from "../../behavior/use-board-access.ts";
import { useBoardFromTemplate } from "../../behavior/use-board-from-template.ts";
import { useBoardPeriod, useBoardRange } from "../../behavior/use-board-period.ts";
import { useDashboardViewed } from "../../behavior/use-dashboard-viewed.ts";
import { useEmptyWidgets } from "../../behavior/use-empty-widgets.ts";
import { useLimitFailedWidgets } from "../../behavior/use-limit-failed-widgets.ts";
import { useModifyCurated } from "../../behavior/use-modify-curated.ts";
import { useOrganizationLibraryOpen } from "../../behavior/use-organization-library-open.ts";
import { useSavedDashboards } from "../../behavior/use-saved-dashboards.ts";
import { useStoreProject } from "../../behavior/use-store-project.ts";
import { useBoardOnScreen, useLangyAsk } from "../../langy/behavior/use-board-langy.ts";
import {
  boardSetupDraft,
  boardSubject,
  widgetActionDraft,
  widgetChartDraft,
  widgetPromptDraft,
} from "../../langy/model/board-langy.ts";
import { BoardLangy } from "../../langy/ui/sections/board-langy.tsx";
import { CURATED_SEGMENT } from "../../model/boards.ts";
import { type CuratedBoard, curatedBoardById } from "../../model/curated-boards.ts";
import { AddBlockCard } from "../blocks/blank-board.tsx";
import { BoardHeader } from "../blocks/board-header.tsx";
import { BoardPage } from "../blocks/board-page.tsx";
import { BoardPeriodControl } from "../blocks/board-period-control.tsx";
import { EmptyWidgetsBanner } from "../blocks/empty-widgets-banner.tsx";
import { LimitFailedWidgetsBanner } from "../blocks/limit-failed-widgets-banner.tsx";
import { ModifyCuratedDialog } from "../blocks/modify-curated-dialog.tsx";
import { AddWidgetButton } from "../elements/add-widget-button.tsx";
import { BlockPickerDialog } from "./block-picker-dialog.tsx";
import { CuratedWidgetsGrid } from "./curated-widgets-grid.tsx";
import { DashboardsGate } from "./dashboards-gate.tsx";

/** Makes the member's own board from the template this board shows, and opens it. */
function UseTemplateButton({ isCreating, onClick }: { isCreating: boolean; onClick: () => void }) {
  return (
    <Button
      size="sm"
      variant="solid"
      colorPalette="accent"
      loading={isCreating}
      loadingText="Adding…"
      onClick={onClick}
    >
      <LayoutTemplate size={14} aria-hidden />
      Use this template
    </Button>
  );
}

function OpenCuratedBoard({
  board,
  atOrganization,
}: {
  board: CuratedBoard;
  atOrganization: boolean;
}) {
  const host = useAnalyticsHost();
  const projectId = host.project()?.id ?? "";
  const saved = useSavedDashboards();
  const { range, refreshApplies } = useBoardRange();
  const autoRefresh = useDashboardAutoRefresh({ live: range === "live", ended: !refreshApplies });
  const { grain, custom, period, setRange, setCustom, setGrain } = useBoardPeriod({
    refreshedAt: autoRefresh.refreshedAt,
  });
  const subject = boardSubject({
    board: {
      id: `${CURATED_SEGMENT}/${board.templateId}`,
      name: board.name,
      templateId: board.templateId,
    },
    widgets: board.widgets,
  });
  useBoardOnScreen({ boardId: subject.id });
  useDashboardViewed({
    dashboardId: subject.id,
    dashboardKind: "curated",
    widgetCount: board.widgets.length,
    isLoaded: true,
    templateId: board.templateId,
  });
  const langy = useLangyAsk();
  const empty = useEmptyWidgets();
  const emptyWidgetNames = empty.emptyNames({ widgets: board.widgets, keyOf: ({ key }) => key });
  const limitFailedWidgets = useLimitFailedWidgets();
  // Whoever may create dashboards picks a widget for a new one; the rest ask Langy.
  const reader = useBoardReader();
  const store = useStoreProject({ enabled: atOrganization });
  // At the organization level the copy is Only me, which asks analytics:update too.
  const mayCreate = atOrganization
    ? store.storeProject !== void 0 && store.mayShare
    : reader.mayCreate;
  // Edits to a From LangWatch board belong to the organization area; off, the page is main's.
  const organizationArea = useOrganizationLibraryOpen().isOpen;
  const mayEdit = organizationArea && mayCreate;
  const { createWithWidget } = useBoardFromTemplate({
    atOrganization,
    storeProject: store.storeProject,
  });
  const existingNames = atOrganization ? store.namesInStore : saved.boards.map(({ name }) => name);
  const storedAt = { atOrganization, storeProject: store.storeProject, existingNames };
  const template = useAddTemplate(storedAt);
  const modify = useModifyCurated({ board, ...storedAt });
  const picker = useBlockPickerAddress();
  const openPicker = () => {
    if (!picker.isOpen) picker.open();
  };
  const addWidget = () => modify.request({ kind: "addWidget" });

  return (
    <BoardPage
      header={
        <BoardHeader
          name={board.name}
          description={board.job}
          isFromLangWatch
          {...(mayEdit
            ? {
                onRename: (name: string) => modify.request({ kind: "rename", name }),
                onDescribe: (description: string) =>
                  modify.request({ kind: "describe", description }),
              }
            : {})}
          pointer={{
            boardKind: "template",
            boardId: board.templateId,
            widgetCount: board.widgets.length,
          }}
          action={
            mayEdit ? (
              <>
                <AddWidgetButton onClick={addWidget} />
                <UseTemplateButton
                  isCreating={template.creatingId !== void 0}
                  onClick={() => void template.add(board.card.board)}
                />
              </>
            ) : null
          }
          periodControl={
            <BoardPeriodControl
              range={range}
              grain={grain}
              custom={custom}
              period={period}
              refresh={autoRefresh.option}
              refreshApplies={refreshApplies}
              onRangeChange={setRange}
              onCustomChange={setCustom}
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
        {...(mayCreate ? { onOpenPicker: openPicker } : {})}
      />
      <DashboardRefetchIntervalContext.Provider value={autoRefresh.refetchInterval}>
        <DashboardRefreshedAtContext.Provider value={autoRefresh.refreshedAt}>
          <VStack align="stretch" gap={4}>
            <EmptyWidgetsBanner
              emptyWidgetNames={emptyWidgetNames}
              onAskLangy={
                langy.enabled
                  ? () => langy.ask(boardSetupDraft({ emptyWidgetNames, board: subject, period }))
                  : undefined
              }
            />
            <LimitFailedWidgetsBanner
              failed={limitFailedWidgets.count({ widgets: board.widgets, keyOf: ({ key }) => key })}
              total={board.widgets.length}
            />
            <CuratedWidgetsGrid
              key={modify.gridKey}
              projectId={projectId}
              projectSlug={saved.projectSlug}
              templateId={board.templateId}
              boardName={board.name}
              widgets={board.widgets}
              period={period}
              periodKey={`${range}:${grain}`}
              langyFor={
                langy.enabled
                  ? (widget) => ({
                      ask: () => langy.ask(widgetPromptDraft({ widget, board: subject, period })),
                      askAbout: (about, click) =>
                        langy.ask(
                          widgetChartDraft({
                            subject: about,
                            click,
                            widget,
                            board: subject,
                            period,
                          }),
                        ),
                      act: (action) =>
                        langy.ask(widgetActionDraft({ action, widget, board: subject, period })),
                    })
                  : undefined
              }
              onEmptyChange={({ widget, empty: isEmpty }) =>
                empty.report({ key: widget.key, empty: isEmpty })
              }
              onLimitFailureChange={({ widget, limited }) =>
                limitFailedWidgets.report({ key: widget.key, limited })
              }
              {...(mayEdit
                ? {
                    onEdit: ({ key }) => modify.request({ kind: "editWidget", key }),
                    onDelete: ({ key }) => modify.request({ kind: "removeWidget", key }),
                    onPlacementsCommit: (placements) =>
                      modify.request({ kind: "move", placements }),
                  }
                : {})}
            />
            {mayEdit && <AddBlockCard onClick={addWidget} />}
          </VStack>
        </DashboardRefreshedAtContext.Provider>
      </DashboardRefetchIntervalContext.Provider>
      {mayCreate && picker.isOpen && !saved.isLoading && (
        <BlockPickerDialog
          board={subject}
          period={period}
          allowBuildYourOwn={false}
          seedsLangyAfterAdd={false}
          onAddWidgets={(question) =>
            createWithWidget({
              question,
              templateId: board.templateId,
              existingNames,
            })
          }
          onSkip={picker.close}
          onClose={picker.close}
        />
      )}
      <ModifyCuratedDialog
        isOpen={modify.isAsking}
        isModifying={modify.isModifying}
        onConfirm={() => void modify.confirm()}
        onCancel={modify.cancel}
      />
    </BoardPage>
  );
}

/** The From LangWatch board the address names; `atOrganization`, a new board goes to the store. */
export function CuratedBoardPage({ atOrganization = false }: { atOrganization?: boolean }) {
  const templateId = useAnalyticsHost().route().params.templateId ?? "";
  const board = curatedBoardById(templateId);
  if (!board) return <UiPageNotFound />;
  return <OpenCuratedBoard key={board.templateId} board={board} atOrganization={atOrganization} />;
}

export default function CuratedBoardScreen() {
  return (
    <DashboardsGate>
      <CuratedBoardPage />
    </DashboardsGate>
  );
}
