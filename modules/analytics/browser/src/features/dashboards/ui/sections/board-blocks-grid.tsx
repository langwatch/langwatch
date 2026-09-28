/**
 * A member's board: its blocks on the shared chart grid, each drawn by
 * `DashboardBlock` over the board's one period, with a drag handle and a
 * block menu over the card's top-right corner.
 */

import { Box, HStack } from "@chakra-ui/react";
import { GripVertical } from "lucide-react";

import type { ChartGridPlacement } from "../../../../model/chart-grid.ts";
import { CHART_GRID_DRAG_HANDLE_CLASS, ChartGrid } from "../../../../ui/sections/chart-grid.tsx";
import { type BlockPeriod, DashboardBlock } from "../../blocks/index.ts";
import type { BoardBlock } from "../../model/board-blocks.ts";
import { BlockMenu } from "../blocks/block-menu.tsx";

export function BoardBlocksGrid({
  projectId,
  blocks,
  period,
  otherBoards,
  isWriting,
  onDuplicate,
  onMove,
  onDelete,
  onPlacementsCommit,
}: {
  projectId: string;
  blocks: readonly BoardBlock[];
  period: BlockPeriod;
  otherBoards: readonly { id: string; name: string }[];
  isWriting: boolean;
  onDuplicate: (boardBlock: BoardBlock) => void;
  onMove: (input: { boardBlock: BoardBlock; toDashboardId: string }) => void;
  onDelete: (boardBlock: BoardBlock) => void;
  onPlacementsCommit: (placements: ChartGridPlacement[]) => void;
}) {
  const byWidgetId = new Map(blocks.map((boardBlock) => [boardBlock.widgetId, boardBlock]));

  return (
    <ChartGrid
      placements={blocks.map(({ placement }) => placement)}
      onPlacementsCommit={onPlacementsCommit}
      renderCard={({ graphId }) => {
        const boardBlock = byWidgetId.get(graphId);
        if (!boardBlock) return null;
        return (
          <Box position="relative" height="full" overflow="hidden">
            <DashboardBlock blockId={boardBlock.block.id} projectId={projectId} {...period} />
            <HStack position="absolute" top={3} right={3} gap={0}>
              <Box
                className={CHART_GRID_DRAG_HANDLE_CLASS}
                cursor="grab"
                color="fg.subtle"
                padding={1}
                title="Drag to move"
              >
                <GripVertical size={14} aria-hidden />
              </Box>
              <BlockMenu
                title={boardBlock.block.title}
                otherBoards={otherBoards}
                disabled={isWriting}
                onDuplicate={() => onDuplicate(boardBlock)}
                onMove={(toDashboardId) => onMove({ boardBlock, toDashboardId })}
                onDelete={() => onDelete(boardBlock)}
              />
            </HStack>
          </Box>
        );
      }}
    />
  );
}
