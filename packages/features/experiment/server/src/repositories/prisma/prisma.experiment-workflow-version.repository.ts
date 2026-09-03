import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { ExperimentRunWorkflowVersion } from "@langwatch/experiment-contract";
import { ExperimentWorkflowVersionPort } from "../../ports/experiment-workflow-version.port";

/** Only what this repository touches. */
export type ExperimentWorkflowVersionDatabase = Pick<PrismaClient, "workflowVersion">;

export class PrismaExperimentWorkflowVersionRepository extends ExperimentWorkflowVersionPort {
  private constructor(private readonly database: ExperimentWorkflowVersionDatabase) {
    super();
  }

  static create(
    database: ExperimentWorkflowVersionDatabase,
  ): PrismaExperimentWorkflowVersionRepository {
    return new PrismaExperimentWorkflowVersionRepository(database);
  }

  async findByIds(input: {
    projectId: string;
    versionIds: string[];
  }): Promise<Record<string, ExperimentRunWorkflowVersion>> {
    if (input.versionIds.length === 0) return {};

    const rows = await this.database.workflowVersion.findMany({
      where: { projectId: input.projectId, id: { in: [...new Set(input.versionIds)] } },
      select: {
        id: true,
        version: true,
        commitMessage: true,
        author: { select: { name: true, image: true } },
      },
    });

    return Object.fromEntries(rows.map((row) => [row.id, row]));
  }
}
