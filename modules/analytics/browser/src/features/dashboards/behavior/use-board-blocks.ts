/**
 * The blocks on the member's boards and the writes the board offers: add,
 * duplicate, move, delete and re-layout, over the existing `dashboardWidgets.*`
 * procedures. Failures travel raw to the host (#5984).
 */

import { analyticsApi } from "../../../behavior/analytics-api.ts";
import { useAnalyticsHost } from "../../../model/analytics-host.ts";
import type { ChartGridPlacement } from "../../../model/chart-grid.ts";
import { type BlockDefinition, findBlock } from "../blocks/index.ts";
import {
  type BoardBlock,
  blockWidgetDefinition,
  boardBlocksOf,
  nextBlockSlot,
} from "../model/board-blocks.ts";

export function useBoardBlocks() {
  const host = useAnalyticsHost();
  const projectId = host.project()?.id ?? "";
  const utils = analyticsApi.useUtils();

  const list = analyticsApi.dashboardWidgets.list.useQuery({ projectId }, { enabled: !!projectId });
  const create = analyticsApi.dashboardWidgets.create.useMutation();
  const updateLayout = analyticsApi.dashboardWidgets.updateLayout.useMutation();
  const batchUpdateLayouts = analyticsApi.dashboardWidgets.batchUpdateLayouts.useMutation();
  const assign = analyticsApi.dashboardWidgets.assignDashboard.useMutation();
  const remove = analyticsApi.dashboardWidgets.delete.useMutation();

  const blocksOn = (dashboardId: string): BoardBlock[] =>
    boardBlocksOf({ widgets: list.data ?? [], dashboardId });

  /** Runs one write, reports a failure to the host, and re-reads the board either way. */
  const write = async ({
    fallbackTitle,
    work,
  }: {
    fallbackTitle: string;
    work: () => Promise<void>;
  }): Promise<boolean> => {
    try {
      await work();
      return true;
    } catch (error) {
      host.failed({ error, fallbackTitle });
      return false;
    } finally {
      await utils.dashboardWidgets.list.invalidate({ projectId });
    }
  };

  const place = async ({
    widgetId,
    dashboardId,
    block,
  }: {
    widgetId: string;
    dashboardId: string;
    block: BlockDefinition;
  }) => {
    const placements = blocksOn(dashboardId)
      .map(({ placement }) => placement)
      .filter(({ graphId }) => graphId !== widgetId);
    const slot = nextBlockSlot({ placements, block });
    await updateLayout.mutateAsync({ projectId, graphId: widgetId, ...slot });
  };

  const addBlock = async ({
    dashboardId,
    blockId,
  }: {
    dashboardId: string;
    blockId: string;
  }): Promise<boolean> => {
    const block = findBlock(blockId);
    if (!block) return false;
    return write({
      fallbackTitle: "Couldn't add the block",
      work: async () => {
        const created = await create.mutateAsync({
          projectId,
          dashboardId,
          ...blockWidgetDefinition({ block }),
        });
        await place({ widgetId: created.id, dashboardId, block });
      },
    });
  };

  const moveBlock = ({
    boardBlock,
    toDashboardId,
  }: {
    boardBlock: BoardBlock;
    toDashboardId: string;
  }) =>
    write({
      fallbackTitle: "Couldn't move the block",
      work: async () => {
        await assign.mutateAsync({
          projectId,
          id: boardBlock.widgetId,
          dashboardId: toDashboardId,
        });
        await place({
          widgetId: boardBlock.widgetId,
          dashboardId: toDashboardId,
          block: boardBlock.block,
        });
      },
    });

  const removeBlock = ({ boardBlock }: { boardBlock: BoardBlock }) =>
    write({
      fallbackTitle: "Couldn't delete the block",
      work: async () => {
        await remove.mutateAsync({ projectId, id: boardBlock.widgetId });
      },
    });

  const commitPlacements = (placements: readonly ChartGridPlacement[]) =>
    write({
      fallbackTitle: "Couldn't save the layout",
      work: async () => {
        await batchUpdateLayouts.mutateAsync({ projectId, layouts: [...placements] });
      },
    });

  return {
    blocksOn,
    status: list.status,
    error: list.error,
    retry: () => void list.refetch(),
    isWriting:
      create.isPending ||
      updateLayout.isPending ||
      assign.isPending ||
      remove.isPending ||
      batchUpdateLayouts.isPending,
    addBlock,
    duplicateBlock: ({
      dashboardId,
      boardBlock,
    }: {
      dashboardId: string;
      boardBlock: BoardBlock;
    }) => addBlock({ dashboardId, blockId: boardBlock.block.id }),
    moveBlock,
    removeBlock,
    commitPlacements,
  };
}
