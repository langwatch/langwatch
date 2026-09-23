import { createLogger } from "@langwatch/observability";

import type { LangWatchQLConnection } from "../repositories/langwatch-ql-executor.repository.ts";
import type { LwqlKeyMapRepository } from "../repositories/langwatch-ql-key-map.repository.ts";
import { LangWatchQLCapabilityService } from "./langwatch-ql-capability.service.ts";
import {
  LangWatchQLProductionProvisioningService,
  type LwqlKeyMapRow,
} from "./langwatch-ql-production-provisioning.service.ts";

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
  private readonly repository: LwqlKeyMapRepository;
  private readonly sourceDatabase: string;
  private readonly connection: LangWatchQLConnection | null;
  private readonly errors: LwqlKeyMapErrorSink;

  private constructor(deps: {
    repository: LwqlKeyMapRepository;
    sourceDatabase: string;
    connection: LangWatchQLConnection | null;
    errors: LwqlKeyMapErrorSink;
  }) {
    this.repository = deps.repository;
    this.sourceDatabase = deps.sourceDatabase;
    this.connection = deps.connection;
    this.errors = deps.errors;
  }

  /**
   * `sourceDatabase` is the ClickHouse database the approved views read,
   * known to a process from its own connection string — taken as an
   * argument rather than parsed here, since that config belongs to the composer.
   */
  static create(options: {
    repository: LwqlKeyMapRepository;
    sourceDatabase: string;
    /** The restricted identity, or `null` where a deployment provisioned none. */
    connection: LangWatchQLConnection | null;
    errors?: LwqlKeyMapErrorSink;
  }): LwqlKeyMapService {
    return new LwqlKeyMapService({
      repository: options.repository,
      sourceDatabase: options.sourceDatabase,
      connection: options.connection,
      errors: options.errors ?? new SilentLwqlKeyMapErrorSink(),
    });
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
