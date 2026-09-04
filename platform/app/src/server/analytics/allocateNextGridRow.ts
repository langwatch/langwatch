import type { PrismaClient } from "~/generated/prisma/client";
import { chartGridBottomRow } from "./chartGrid";

/**
 * The next free grid row on a dashboard, counting every chart already on it:
 * the row just below the lowest card's bottom edge, so a new card never lands
 * on top of a tall one.
 *
 * One shared decision rather than two writers guessing: a builder graph
 * created with no explicit row and a saved workbench chart placed with no
 * explicit row both call this, so neither can land on a row the other already
 * occupies. Deliberately not filtered by `kind` — the grid is one shared
 * space, and scoping this to one kind would place a new chart on top of
 * whichever kind it ignored.
 *
 * @see platform/app/src/server/api/routers/graphs.ts — the builder's writer
 * @see ./saved-workbench-charts/savedWorkbenchChart.service.ts — the
 *   workbench's writer
 */
export async function allocateNextGridRow(
  prisma: PrismaClient,
  { dashboardId, projectId }: { dashboardId: string; projectId: string },
): Promise<number> {
  const cards = await prisma.customGraph.findMany({
    where: { dashboardId, projectId },
    select: { gridRow: true, rowSpan: true },
  });
  return chartGridBottomRow(cards);
}
