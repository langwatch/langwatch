import type { PrismaClient } from "~/generated/prisma/client";
import { isAggregateProjectKind } from "../projects/project-kinds";
import { MonitorOnAggregateProjectError } from "./errors";

/**
 * Refuses a monitor whose project is an aggregate (ADR-144 decision 8). Every
 * route that writes a monitor asks this, so hiding Online Evals from the
 * aggregate's navigation is a convenience and not the guard.
 */
export function assertProjectKindRunsMonitors(
  kind: string | null | undefined,
): void {
  if (isAggregateProjectKind(kind)) throw new MonitorOnAggregateProjectError();
}

/** {@link assertProjectKindRunsMonitors} for a caller holding only the id. */
export async function assertProjectRunsMonitors({
  prisma,
  projectId,
}: {
  prisma: PrismaClient;
  projectId: string;
}): Promise<void> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { kind: true },
  });
  assertProjectKindRunsMonitors(project?.kind);
}
