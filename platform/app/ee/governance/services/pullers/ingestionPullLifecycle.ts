import { createLogger } from "@langwatch/observability";
import type { IngestionSource, PrismaClient } from "@prisma/client";
import {
  ensureHiddenGovernanceProject,
  PROJECT_KIND,
} from "../governanceProject.service";

const logger = createLogger("langwatch:governance:ingestion-pull-lifecycle");

/** Tenant identity travels in the dispatch context, never in the payload. */
export interface IngestionPullLifecycleCommands {
  configure(
    input: {
      occurredAt: number;
      sourceId: string;
      cron: string;
      configVersion: string;
      cursor: string | null;
    },
    ctx: { readonly tenantId: string },
  ): Promise<unknown>;
  disable(
    input: { occurredAt: number; sourceId: string; configVersion: string },
    ctx: { readonly tenantId: string },
  ): Promise<unknown>;
}

function cursorOf(
  source: Pick<IngestionSource, "pollerCursor">,
): string | null {
  if (typeof source.pollerCursor === "string") return source.pollerCursor;
  return source.pollerCursor == null
    ? null
    : JSON.stringify(source.pollerCursor);
}

export async function syncIngestionPullSource(params: {
  prisma: PrismaClient;
  commands: IngestionPullLifecycleCommands;
  source: IngestionSource;
}): Promise<void> {
  const { source } = params;
  const project = await ensureHiddenGovernanceProject(
    params.prisma,
    source.organizationId,
  );
  const occurredAt = Date.now();
  const configVersion = `${source.updatedAt.getTime()}:${source.status}:${source.pullSchedule}:${source.archivedAt?.getTime() ?? "live"}`;
  const enabled =
    source.pullSchedule !== null &&
    source.archivedAt === null &&
    (source.status === "active" || source.status === "awaiting_first_event");
  if (enabled && source.pullSchedule) {
    await params.commands.configure(
      {
        occurredAt,
        sourceId: source.id,
        cron: source.pullSchedule,
        configVersion,
        cursor: cursorOf(source),
      },
      { tenantId: project.id },
    );
  } else {
    await params.commands.disable(
      { occurredAt, sourceId: source.id, configVersion },
      { tenantId: project.id },
    );
  }
}

export async function reconcileIngestionPullProcesses(params: {
  prisma: PrismaClient;
  commands: IngestionPullLifecycleCommands;
}): Promise<{ reconciled: number; failed: number }> {
  const governanceProjects = await params.prisma.project.findMany({
    where: {
      kind: PROJECT_KIND.INTERNAL_GOVERNANCE,
      archivedAt: null,
    },
    select: { id: true },
  });
  const governanceProjectIds = governanceProjects.map(({ id }) => id);
  const existingProcesses =
    governanceProjectIds.length === 0
      ? []
      : await params.prisma.processManagerInstance.findMany({
          where: {
            processName: "ingestionPull",
            projectId: { in: governanceProjectIds },
          },
          select: { processKey: true },
        });
  const sources = await params.prisma.ingestionSource.findMany({
    where: {
      OR: [
        { pullSchedule: { not: null } },
        { id: { in: existingProcesses.map((row) => row.processKey) } },
      ],
    },
  });
  let reconciled = 0;
  let failed = 0;
  for (const source of sources) {
    try {
      await syncIngestionPullSource({ ...params, source });
      reconciled += 1;
    } catch (error) {
      failed += 1;
      // The aggregate count alone strands an operator: name the source and
      // the reason so a nonzero `failed` is actionable.
      logger.warn(
        {
          sourceId: source.id,
          error: error instanceof Error ? error.message : String(error),
        },
        "Reconciling this ingestion source's pull process failed; the next boot retries it",
      );
    }
  }
  return { reconciled, failed };
}
