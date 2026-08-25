import { createLogger } from "@langwatch/observability";
import { parseConnectionUrl } from "~/server/clickhouse/goose";
import { captureException } from "~/utils/posthogErrorCapture";
import { lwqlTenantCapability } from "./capability";
import { lwqlConnectionFromEnv } from "./executor";
import type { LwqlKeyMapRepository } from "./lwqlKeyMap.repository";
import {
  lwqlKeyMapTableQualifiedName,
  productionLangWatchQLNames,
  type LwqlKeyMapRow,
} from "./productionProvisioning";

const logger = createLogger("langwatch:lwql-key-map-service");

export class LwqlKeyMapService {
  private constructor(private readonly repository: LwqlKeyMapRepository) {}

  static create(repository: LwqlKeyMapRepository): LwqlKeyMapService {
    return new LwqlKeyMapService(repository);
  }

  /**
   * Best-effort synchronization. The deploy-time backfill repairs any missed
   * row, so project creation must not fail when ClickHouse is unavailable.
   */
  async syncProject(input: {
    projectId: string;
    lwqlKey: string | null;
  }): Promise<void> {
    const connection = lwqlConnectionFromEnv();
    if (!connection) return;

    if (!input.lwqlKey) {
      logger.error(
        { projectId: input.projectId },
        "new project has an empty lwqlKey — cannot sync its LangWatchQL key-map row",
      );
      return;
    }

    try {
      const names = productionLangWatchQLNames({ connection });
      const { database: sourceDatabase } = parseConnectionUrl();
      const row: LwqlKeyMapRow = {
        KeyHash: lwqlTenantCapability({ secret: input.lwqlKey }),
        TenantId: input.projectId,
      };
      await this.repository.insertRow({
        table: lwqlKeyMapTableQualifiedName({ names, sourceDatabase }),
        row,
      });
    } catch (error) {
      logger.error(
        { projectId: input.projectId, error },
        "failed to sync LangWatchQL key-map row; the scheduled backfill will retry it",
      );
      captureException(new Error("Failed to sync LangWatchQL key-map row"), {
        extra: { projectId: input.projectId, error },
      });
    }
  }
}
