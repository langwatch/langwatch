import { createLogger } from "@langwatch/observability";

import { lwqlTenantCapability } from "../langwatch-ql/capability";
import { lwqlConnectionFromEnv } from "../langwatch-ql/executor";
import {
  lwqlKeyMapTableQualifiedName,
  productionLangWatchQLNames,
  type LwqlKeyMapRow,
} from "../langwatch-ql/production-provisioning";
import type { LwqlKeyMapRepository } from "../repositories/clickhouse/clickhouse.langwatch-ql-key-map.repository";

const logger = createLogger("langwatch:lwql-key-map-service");

/**
 * Where a failed sync is reported beyond the log line.
 *
 * A port because the sink is the deployment's: the row is repaired by the
 * scheduled backfill either way, so what this class owes the operator is a
 * report, and which reporter receives it is not the feature's decision.
 */
export abstract class LwqlKeyMapErrorSinkPort {
  abstract capture(error: Error, context: Readonly<{ projectId: string; cause: unknown }>): void;
}

/** Reports nothing beyond the log line, for a deployment that wired no sink. */
class SilentLwqlKeyMapErrorSink extends LwqlKeyMapErrorSinkPort {
  capture(): void {}
}

export class LwqlKeyMapService {
  private constructor(
    private readonly repository: LwqlKeyMapRepository,
    private readonly sourceDatabase: string,
    private readonly errors: LwqlKeyMapErrorSinkPort,
  ) {}

  /**
   * `sourceDatabase` is the ClickHouse database the approved views read, which
   * a process knows from its own connection string. Taken as an argument
   * rather than parsed here, because a package that parsed the deployment's
   * connection string would be reading configuration that belongs to whoever
   * composed it.
   */
  static create(options: {
    repository: LwqlKeyMapRepository;
    sourceDatabase: string;
    errors?: LwqlKeyMapErrorSinkPort;
  }): LwqlKeyMapService {
    return new LwqlKeyMapService(
      options.repository,
      options.sourceDatabase,
      options.errors ?? new SilentLwqlKeyMapErrorSink(),
    );
  }

  /**
   * Best-effort synchronization. The deploy-time backfill repairs any missed
   * row, so project creation must not fail when ClickHouse is unavailable.
   */
  async syncProject(input: { projectId: string; lwqlKey: string | null }): Promise<void> {
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
      const row: LwqlKeyMapRow = {
        KeyHash: lwqlTenantCapability({ secret: input.lwqlKey }),
        TenantId: input.projectId,
      };
      await this.repository.insertRow({
        table: lwqlKeyMapTableQualifiedName({ names, sourceDatabase: this.sourceDatabase }),
        row,
      });
    } catch (error) {
      logger.error(
        { projectId: input.projectId, error },
        "failed to sync LangWatchQL key-map row; the scheduled backfill will retry it",
      );
      this.errors.capture(new Error("Failed to sync LangWatchQL key-map row"), {
        projectId: input.projectId,
        cause: error,
      });
    }
  }
}
