import type { DataRetentionApi } from "@langwatch/data-retention-contract";
import { RETENTION_TABLE_CATEGORY_MAP } from "@langwatch/data-retention-contract/retention-tables";

import { ExperimentDspyRetentionRepository } from "../repositories/experiment-dspy-retention.repository.ts";

/** How long a project keeps its optimization steps, as the data-retention owner answers it. */
export class ExperimentDspyRetentionService extends ExperimentDspyRetentionRepository {
  static create(peers: {
    retention: Pick<DataRetentionApi, "getRetentionDays">;
  }): ExperimentDspyRetentionService {
    return new ExperimentDspyRetentionService(peers.retention);
  }

  private constructor(private readonly retention: Pick<DataRetentionApi, "getRetentionDays">) {
    super();
  }

  findTraceRetentionDays(tenantId: string): Promise<number> {
    return this.retention.getRetentionDays({
      projectId: tenantId,
      category: RETENTION_TABLE_CATEGORY_MAP.dspy_steps,
    });
  }
}
