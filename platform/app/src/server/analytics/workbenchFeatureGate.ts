/**
 * The experimental gate over the whole governed SQL workbench surface.
 *
 * One flag, one evaluation, shared by every entry point — the query router, the
 * saved-chart router, and whatever reaches the surface next. Two callers
 * evaluating the same flag differently is not a style problem: it is a member
 * who can run a query but not save it, or the reverse, depending on which
 * question the browser asked first.
 *
 * The decision itself lives in `governedSqlEnabled`, which the REST boundary
 * also asks; this module is the tRPC-side name for it. Re-implementing the
 * evaluation here would put the same "two callers, two answers" bug back, one
 * protocol up.
 *
 * @see ~/server/analytics/governed-sql/access.ts — the single evaluation
 * @see specs/analytics/governed-sql-workbench.feature
 * @see specs/analytics/governed-sql-saved-charts.feature
 */

import type { PrismaClient } from "~/generated/prisma/client";

import {
  GOVERNED_SQL_FLAG,
  governedSqlEnabled,
} from "~/server/analytics/governed-sql/access";

/** The one switch the whole workbench surface is behind. */
export const GOVERNED_SQL_WORKBENCH_FLAG = GOVERNED_SQL_FLAG;

/**
 * Whether the workbench surface is switched on for this project.
 *
 * Evaluated server-side, so nothing in the browser can force it on. The
 * identity is the project rather than the member — see `access.ts` for why.
 */
export async function workbenchEnabled({
  projectId,
  prisma,
}: {
  projectId: string;
  prisma: PrismaClient;
}): Promise<boolean> {
  return governedSqlEnabled({ prisma, projectId });
}
