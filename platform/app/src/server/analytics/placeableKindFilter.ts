import type { PrismaClient } from "~/generated/prisma/client";
import {
  BUILDER_CHART_KIND,
  WORKBENCH_SQL_CHART_KIND,
} from "~/server/analytics/chartKinds";
import { lwqlEnabled } from "~/server/analytics/lwql/access";

/**
 * The kinds that can sit on a dashboard grid *when the workbench is on*.
 *
 * Used only by the procedures that move, resize, remove or count a *card*.
 * Anything that reads or writes a row's `graph` payload stays scoped to the
 * single kind whose shape it understands.
 */
export const PLACEABLE_CHART_KINDS = [
  BUILDER_CHART_KIND,
  WORKBENCH_SQL_CHART_KIND,
] as const;

/** The `kind` clause a card-level query sends to Prisma. */
export type PlaceableKindWhere = { kind: string | { in: string[] } };

/**
 * The kinds a card-level query may touch for this project.
 *
 * Asked by every card-level procedure — the graph-card read, all three
 * placement writes, and the dashboard list's card count — so that a
 * deployment with the workbench off sees exactly the grid it saw before, and
 * cannot move, resize, delete or *count* a `workbench_sql` row left behind by
 * a trial. Gating only the read would leave the rows invisible but still
 * mutable: a member's reflow of the charts they *can* see would silently
 * rewrite the placement of ones they cannot, a delete by id would remove a
 * row the surface never admitted existed, and a list count that skipped the
 * gate would advertise cards the detail read will not return.
 */
export async function placeableKindFilter({
  prisma,
  projectId,
}: {
  prisma: PrismaClient;
  projectId: string;
}): Promise<PlaceableKindWhere> {
  // The filter itself rather than the kind list, so every caller emits the
  // identical clause. With the workbench off that clause is the bare
  // `kind: "builder"` the grid used before this feature existed — which is
  // what makes "exactly the old grid" a statement about the query and not
  // just about the rows it happens to return.
  return (await lwqlEnabled({ prisma, projectId }))
    ? { kind: { in: [...PLACEABLE_CHART_KINDS] } }
    : { kind: BUILDER_CHART_KIND };
}
