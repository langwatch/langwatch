import type { PrismaClient } from "~/generated/prisma/client";
import {
  BUILDER_CHART_KIND,
  PLAYGROUND_SRCDOC_CHART_KIND,
  WORKBENCH_SQL_CHART_KIND,
} from "~/server/analytics/chartKinds";
import { lwqlEnabled } from "~/server/analytics/lwql/access";
import { customChartPlaygroundEnabled } from "~/server/analytics/playground-widgets/access";

/**
 * The kinds that can sit on a dashboard grid when EVERY optional chart
 * feature is on. The kinds actually placeable for a given project are a
 * subset of this — see {@link placeableKindFilter}, which asks each kind's
 * own flag independently. Workbench and playground are not mutually
 * exclusive here the way their WRITES are: a project can carry old
 * `workbench_sql` rows placed before the playground shipped and new
 * `playground_srcdoc` rows side by side, and both must keep rendering.
 */
export const PLACEABLE_CHART_KINDS = [
  BUILDER_CHART_KIND,
  WORKBENCH_SQL_CHART_KIND,
  PLAYGROUND_SRCDOC_CHART_KIND,
] as const;

/** The `kind` clause a card-level query sends to Prisma. */
export type PlaceableKindWhere = { kind: string | { in: string[] } };

/**
 * The kinds a card-level query may touch for this project.
 *
 * Asked by every card-level procedure — the graph-card read, all three
 * placement writes, and the dashboard list's card count — so that a
 * deployment with a feature off sees exactly the grid it saw before, and
 * cannot move, resize, delete or *count* a `workbench_sql`/`playground_srcdoc`
 * row left behind by a trial. Gating only the read would leave the rows
 * invisible but still mutable: a member's reflow of the charts they *can* see
 * would silently rewrite the placement of ones they cannot, a delete by id
 * would remove a row the surface never admitted existed, and a list count
 * that skipped the gate would advertise cards the detail read will not
 * return.
 */
export async function placeableKindFilter({
  prisma,
  projectId,
}: {
  prisma: PrismaClient;
  projectId: string;
}): Promise<PlaceableKindWhere> {
  // Each optional kind asks its own flag and is added independently — not an
  // all-or-nothing switch — so that reads/rendering stay correct regardless
  // of which combination of flags a project happens to carry. This mirrors
  // the write-side mutual exclusion (release_custom_chart_playground turns
  // OFF `chart`/`graph` writes) without applying it here: rows already placed
  // under the other flag are still SOMEONE's dashboard and must keep
  // rendering. With every optional kind off, the clause is the bare
  // `kind: "builder"` the grid used before either feature existed — which is
  // what makes "exactly the old grid" a statement about the query and not
  // just about the rows it happens to return.
  const kinds: string[] = [BUILDER_CHART_KIND];
  if (await lwqlEnabled({ prisma, projectId })) {
    kinds.push(WORKBENCH_SQL_CHART_KIND);
  }
  if (await customChartPlaygroundEnabled({ prisma, projectId })) {
    kinds.push(PLAYGROUND_SRCDOC_CHART_KIND);
  }
  return kinds.length > 1 ? { kind: { in: kinds } } : { kind: BUILDER_CHART_KIND };
}
