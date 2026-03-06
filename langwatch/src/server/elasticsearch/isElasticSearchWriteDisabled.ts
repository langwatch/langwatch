import type { PrismaClient } from "@prisma/client";
import { createLogger } from "~/utils/logger/server";

const logger = createLogger("langwatch:elasticsearch:write-disabled");

/** Set of projectId:domain keys for which the misconfiguration warning has already been logged */
const warnedProjects = new Set<string>();

export type ElasticSearchWriteDomain =
  | "traces"
  | "evaluations"
  | "simulations";

/**
 * Domain-specific mapping from the generic domain name to the corresponding
 * project flags for disabling ES writes, CH read, and event sourcing write.
 */
const FLAG_MAP = {
  traces: {
    disableFlag: "disableElasticSearchTraceWriting",
    chReadFlag: "featureClickHouseDataSourceTraces",
    esWriteFlag: "featureEventSourcingTraceIngestion",
  },
  evaluations: {
    disableFlag: "disableElasticSearchEvaluationWriting",
    chReadFlag: "featureClickHouseDataSourceEvaluations",
    esWriteFlag: "featureEventSourcingEvaluationIngestion",
  },
  simulations: {
    disableFlag: "disableElasticSearchSimulationWriting",
    chReadFlag: "featureClickHouseDataSourceSimulations",
    esWriteFlag: "featureEventSourcingSimulationIngestion",
  },
} as const;

/**
 * Check whether Elasticsearch writes are disabled for a given project and
 * data domain.
 *
 * Returns `true` when the project-level `disableElasticSearch*Writing` flag
 * is ON, meaning the caller should skip any ES indexing.
 *
 * Logs a warning (once per project+domain) when ES writes are disabled but
 * the corresponding ClickHouse read flag or event-sourcing write flag is
 * not enabled -- this could mean data is being lost.
 */
export async function isElasticSearchWriteDisabled(
  prisma: PrismaClient,
  projectId: string,
  domain: ElasticSearchWriteDomain,
): Promise<boolean> {
  const { disableFlag, chReadFlag, esWriteFlag } = FLAG_MAP[domain];

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      [disableFlag]: true,
      [chReadFlag]: true,
      [esWriteFlag]: true,
    },
  });

  if (!project) {
    return false;
  }

  const disabled = Boolean(project[disableFlag]);

  if (disabled) {
    const chReadEnabled = Boolean(project[chReadFlag]);
    const esWriteEnabled = Boolean(project[esWriteFlag]);
    const warnKey = `${projectId}:${domain}`;

    if ((!chReadEnabled || !esWriteEnabled) && !warnedProjects.has(warnKey)) {
      warnedProjects.add(warnKey);
      logger.warn(
        { projectId, domain, chReadEnabled, esWriteEnabled },
        `Elasticsearch ${domain} writes are disabled but ClickHouse read (${chReadFlag}=${String(chReadEnabled)}) ` +
          `or event-sourcing write (${esWriteFlag}=${String(esWriteEnabled)}) is not enabled — data may be lost`,
      );
    }
  }

  return disabled;
}
