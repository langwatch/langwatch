import { AggregateProjectIsReadOnlyError } from "../projects/errors";
import { isAggregateProjectKind } from "../projects/project-kinds";

/**
 * Refuses a monitor whose project is an aggregate (ADR-144 decision 8), with
 * the read-only answer every other write under an aggregate gives, so a
 * client sees one code whichever surface it came through. The tRPC monitor
 * writes are refused earlier, by the permission middleware's write guard;
 * the REST create, which that middleware does not cover, asks this.
 */
export function assertProjectKindRunsMonitors(
  kind: string | null | undefined,
): void {
  if (isAggregateProjectKind(kind)) throw new AggregateProjectIsReadOnlyError();
}
