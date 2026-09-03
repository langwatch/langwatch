import {
  IngestionPullLifecycleRepository,
  type IngestionPullLifecycleDatabase,
  type IngestionPullLifecycleSource,
} from "../../ports/ingestion-pull-lifecycle.port";

const INTERNAL_GOVERNANCE_PROJECT_KIND = "internal_governance";
const INGESTION_PULL_PROCESS_NAME = "ingestionPull";

export class PrismaIngestionPullLifecycleRepository extends IngestionPullLifecycleRepository {
  private constructor(private readonly database: IngestionPullLifecycleDatabase) {
    super();
  }

  static create(database: IngestionPullLifecycleDatabase): PrismaIngestionPullLifecycleRepository {
    return new PrismaIngestionPullLifecycleRepository(database);
  }

  async listForReconciliation(): Promise<IngestionPullLifecycleSource[]> {
    const projects = await this.database.project.findMany({
      where: { kind: INTERNAL_GOVERNANCE_PROJECT_KIND, archivedAt: null },
      select: { id: true },
    });
    const projectIds = projects.map(({ id }) => id);
    const processes =
      projectIds.length === 0
        ? []
        : await this.database.processManagerInstance.findMany({
            where: {
              processName: INGESTION_PULL_PROCESS_NAME,
              projectId: { in: projectIds },
            },
            select: { processKey: true },
          });

    return this.database.ingestionSource.findMany({
      where: {
        OR: [
          { pullSchedule: { not: null } },
          { id: { in: processes.map(({ processKey }) => processKey) } },
        ],
      },
    });
  }
}
