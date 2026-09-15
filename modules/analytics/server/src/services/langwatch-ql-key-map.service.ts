import { createLogger } from "@langwatch/observability";

import { LangWatchQLCapabilityService } from "./langwatch-ql-capability.service.ts";

import type { LangWatchQLConnection } from "../repositories/langwatch-ql-executor.repository.ts";
import {
  LangWatchQLProductionProvisioningService,
  type LwqlKeyMapRow,
} from "./langwatch-ql-production-provisioning.service.ts";
import type { LwqlKeyMapRepository } from "../repositories/langwatch-ql-key-map.repository.ts";

const lwqlProvisioning = LangWatchQLProductionProvisioningService.create();

const lwqlCapability = LangWatchQLCapabilityService.create();

const logger = createLogger("langwatch:lwql-key-map-service");

/**
 * Where a failed sync is reported beyond the log line.
 */
export abstract class LwqlKeyMapErrorSink {
  abstract capture(error: Error, context: Readonly<{ projectId: string; cause: unknown }>): void;
}

/** Reports nothing beyond the log line, for a deployment that wired no sink. */
class SilentLwqlKeyMapErrorSink extends LwqlKeyMapErrorSink {
  capture(): void {}
}

export class LwqlKeyMapService {
  private constructor(
    private readonly repository: LwqlKeyMapRepository,
    private readonly sourceDatabase: string,
    private readonly connection: LangWatchQLConnection | null,
    private readonly errors: LwqlKeyMapErrorSink,
  ) {}

  /**
   * `sourceDatabase` is the ClickHouse database the approved views read, which a process knows from its own
   * connection string. Taken as an argument rather than parsed here, because a package that parsed the deployment's
   * connection string would be reading configuration that belongs to whoever composed it.
   */
  static create(options: {
    repository: LwqlKeyMapRepository;
    sourceDatabase: string;
    /** The restricted identity, or `null` where a deployment provisioned none. */
    connection: LangWatchQLConnection | null;
    errors?: LwqlKeyMapErrorSink;
  }): LwqlKeyMapService {
    return new LwqlKeyMapService(
      options.repository,
      options.sourceDatabase,
      options.connection,
      options.errors ?? new SilentLwqlKeyMapErrorSink(),
    );
  }

  /**
   * Best-effort synchronization. The deploy-time backfill repairs any missed
   * row, so project creation must not fail when ClickHouse is unavailable.
   */
  async syncProject(input: { projectId: string; lwqlKey: string | null }): Promise<void> {
    const { connection } = this;
    if (!connection) {
      return;
    }

    if (!input.lwqlKey) {
      logger.error(
        { projectId: input.projectId },
        "new project has an empty lwqlKey — cannot sync its LangWatchQL key-map row",
      );

      return;
    }

    try {
      const names = lwqlProvisioning.names({ connection });
      const row: LwqlKeyMapRow = {
        KeyHash: lwqlCapability.tenantCapability({ secret: input.lwqlKey }),
        TenantId: input.projectId,
      };
      await this.repository.insertRow({
        table: lwqlProvisioning.keyMapTableQualifiedName({
          names,
          sourceDatabase: this.sourceDatabase,
        }),
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
