/**
 * One board: the Agent Flight Deck when the address names it, read-only with
 * its panels, otherwise one of the member's own, editable, with its blocks on
 * the grid or the blank-board state. Both share the header and the picker.
 */

import { Box, Spinner, VStack } from "@chakra-ui/react";
import { UiPageLoading, UiPageNotFound } from "@langwatch/ui-kernel/page-fallbacks";
import type { ReactNode } from "react";

import { useAnalyticsHost } from "../../../../model/analytics-host.ts";
import { HandledErrorAlert } from "../../../../ui/elements/handled-error-alert.tsx";
import { useBlockPickerAddress } from "../../behavior/use-block-picker-address.ts";
import { useBoardBlocks } from "../../behavior/use-board-blocks.ts";
import { useBoardDescription } from "../../behavior/use-board-description.ts";
import { useBoardPeriod } from "../../behavior/use-board-period.ts";
import { useBoardVisibility } from "../../behavior/use-board-visibility.ts";
import { type SavedBoard, useSavedDashboards } from "../../behavior/use-saved-dashboards.ts";
import { FlightDeckPanels } from "../../blocks/index.ts";
import { FLIGHT_DECK_SUBJECT, ownBoardSubject } from "../../langy/model/board-langy.ts";
import { BoardLangy } from "../../langy/ui/sections/board-langy.tsx";
import { dashboardsPath, FLIGHT_DECK } from "../../model/boards.ts";
import { AddBlockCard, BlankBoard } from "../blocks/blank-board.tsx";
import { BoardHeader } from "../blocks/board-header.tsx";
import { BoardPeriodControl } from "../blocks/board-period-control.tsx";
import { BoardVisibilityControl } from "../blocks/board-visibility-control.tsx";
import { BlockPickerDialog } from "./block-picker-dialog.tsx";
import { BoardBlocksGrid } from "./board-blocks-grid.tsx";
import { DashboardsGate } from "./dashboards-gate.tsx";

function BoardPage({
  header,
  areaLabel,
  children,
}: {
  header: ReactNode;
  areaLabel: string;
  children: ReactNode;
}) {
  // The prototype's narrow page: charts hold their shape at 980px.
  return (
    <VStack
      align="stretch"
      gap={0}
      width="full"
      maxWidth="980px"
      marginX="auto"
      paddingX={8}
      paddingY={6}
    >
      {header}
      <Box as="section" aria-label={areaLabel} minHeight="240px">
        {children}
      </Box>
    </VStack>
  );
}

function usePeriodControl() {
  const { range, grain, period, setRange, setGrain } = useBoardPeriod();
  const control = (
    <BoardPeriodControl
      range={range}
      grain={grain}
      onRangeChange={setRange}
      onGrainChange={setGrain}
    />
  );
  return { period, control };
}

function FlightDeckBoard() {
  const projectId = useAnalyticsHost().project()?.id;
  const { period, control } = usePeriodControl();
  const picker = useBlockPickerAddress();

  return (
    <BoardPage
      areaLabel="Panels"
      header={
        <BoardHeader
          name={FLIGHT_DECK.name}
          isDefault={FLIGHT_DECK.isDefault}
          description={FLIGHT_DECK.description}
          onAddChart={picker.open}
          periodControl={control}
        />
      }
    >
      <BoardLangy board={FLIGHT_DECK_SUBJECT} period={period} projectId={projectId ?? ""} />
      {projectId && <FlightDeckPanels projectId={projectId} {...period} />}
      {picker.isOpen && (
        <BlockPickerDialog board={FLIGHT_DECK_SUBJECT} period={period} onClose={picker.close} />
      )}
    </BoardPage>
  );
}

function OwnBoard({ board }: { board: SavedBoard }) {
  const host = useAnalyticsHost();
  const projectId = host.project()?.id ?? "";
  const saved = useSavedDashboards();
  const boardBlocks = useBoardBlocks();
  const { description, saveDescription } = useBoardDescription({
    dashboardId: board.id,
    stored: board.description,
  });
  const visibility = useBoardVisibility({ board });
  const { period, control } = usePeriodControl();
  const picker = useBlockPickerAddress();
  const blocks = boardBlocks.blocksOn(board.id);
  const otherBoards = saved.boards.filter(({ id }) => id !== board.id);
  const subject = ownBoardSubject({ board, blocks });

  return (
    <BoardPage
      areaLabel="Blocks"
      header={
        <BoardHeader
          name={board.name}
          isDefault={false}
          description={description}
          visibility={visibility.visibility}
          onRename={(name) => saved.renameBoard({ dashboardId: board.id, name })}
          onDescribe={saveDescription}
          onAddChart={picker.open}
          periodControl={control}
          visibilityControl={
            <BoardVisibilityControl
              visibility={visibility.visibility}
              canChange={visibility.canChange}
              refusal={visibility.refusal}
              onChange={visibility.setVisibility}
            />
          }
        />
      }
    >
      <BoardLangy
        board={subject}
        period={period}
        projectId={projectId}
        watched={{ blocks, settled: boardBlocks.status === "success" }}
      />
      {boardBlocks.status === "pending" && <Spinner size="sm" />}
      {boardBlocks.status === "error" && (
        <HandledErrorAlert
          error={boardBlocks.error}
          fallbackTitle="This dashboard could not load its blocks"
        />
      )}
      {boardBlocks.status === "success" && blocks.length === 0 && (
        <BlankBoard
          onAddBlock={picker.open}
          onOpenTemplate={() =>
            host.navigate(
              dashboardsPath({ projectSlug: saved.projectSlug, dashboardId: FLIGHT_DECK.id }),
            )
          }
        />
      )}
      {boardBlocks.status === "success" && blocks.length > 0 && (
        <VStack align="stretch" gap={4}>
          <BoardBlocksGrid
            projectId={projectId}
            blocks={blocks}
            period={period}
            otherBoards={otherBoards}
            isWriting={boardBlocks.isWriting}
            onDuplicate={(boardBlock) =>
              void boardBlocks.duplicateBlock({ dashboardId: board.id, boardBlock })
            }
            onMove={(input) => void boardBlocks.moveBlock(input)}
            onDelete={(boardBlock) => void boardBlocks.removeBlock({ boardBlock })}
            onPlacementsCommit={(placements) => void boardBlocks.commitPlacements(placements)}
          />
          <AddBlockCard compact onClick={picker.open} />
        </VStack>
      )}
      {picker.isOpen && (
        <BlockPickerDialog board={subject} period={period} onClose={picker.close} />
      )}
    </BoardPage>
  );
}

function SavedBoardScreen({ dashboardId }: { dashboardId: string | undefined }) {
  const { boards, isLoading } = useSavedDashboards();
  if (isLoading) return <UiPageLoading />;
  const board = boards.find(({ id }) => id === dashboardId);
  if (!board) return <UiPageNotFound />;
  // Keyed so a board's in-flight edits never leak into the next board.
  return <OwnBoard key={board.id} board={board} />;
}

function Board() {
  const dashboardId = useAnalyticsHost().route().params.dashboardId;
  if (dashboardId === FLIGHT_DECK.id) return <FlightDeckBoard />;
  return <SavedBoardScreen dashboardId={dashboardId} />;
}

export default function DashboardBoardScreen() {
  return (
    <DashboardsGate>
      <Board />
    </DashboardsGate>
  );
}
