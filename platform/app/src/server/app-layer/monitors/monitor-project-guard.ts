import { AggregateProjectIsReadOnlyError } from "../projects/errors";
import type { ProjectService } from "../projects/project.service";
import { isAggregateProjectKind } from "../projects/project-kinds";

/**
 * Refuses a monitor whose project is an aggregate (ADR-144 decision 8), with
 * the read-only answer every other write under an aggregate gives, so a
 * client sees one code whichever surface it came through. Every route that
 * writes a monitor asks this, so hiding Online Evals from the aggregate's
 * navigation is a convenience and not the guard.
 */
export function assertProjectKindRunsMonitors(
  kind: string | null | undefined,
): void {
  if (isAggregateProjectKind(kind)) throw new AggregateProjectIsReadOnlyError();
}

/** {@link assertProjectKindRunsMonitors} for a caller holding only the id. */
export async function assertProjectRunsMonitors({
  projects,
  projectId,
}: {
  projects: Pick<ProjectService, "getKindById">;
  projectId: string;
}): Promise<void> {
  assertProjectKindRunsMonitors(await projects.getKindById(projectId));
}
