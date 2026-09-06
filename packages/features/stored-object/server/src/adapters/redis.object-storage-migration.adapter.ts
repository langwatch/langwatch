import {
  RedisConnectionService,
  type RedisConnection,
  type RedisLogger,
} from "@langwatch/redis-client";
import { Cluster } from "ioredis";
import {
  GroupQueueObjectStorageMigrationAdapter,
  type QueueAuditRedis,
} from "./group-queue.object-storage-migration.adapter";
import type { QueueMigrationBlocker } from "../services/object-storage-migration.service";

export type MigrationCutoverRedisConfig = {
  url?: string;
  clusterEndpoints?: string;
  dbIndex?: string;
};

type MigrationCutoverAuditLease = {
  redis: QueueAuditRedis;
  scanNodes: QueueAuditRedis[];
  cleanup(): void;
};

type MigrationCutoverAuditLeaseFactory = (
  connection: RedisConnection,
  logger: RedisLogger,
) => Promise<MigrationCutoverAuditLease>;

/** Task-local Redis owner for the final GroupQueue cutover audit. */
export class MigrationCutoverRedisAuditAdapter {
  /**
   * The shared app cluster client runs `scaleReads: "all"`, allowing reads from a
   * lagging replica. Finalization must instead audit through a master-only
   * duplicate so a stale replica cannot report a false clean cutover.
   */
  static async createAuditLease(
    sharedConnection: RedisConnection,
    logger?: RedisLogger,
  ): Promise<MigrationCutoverAuditLease> {
    if (!(sharedConnection instanceof Cluster)) {
      return {
        redis: sharedConnection,
        scanNodes: [sharedConnection],
        cleanup: () => void 0,
      };
    }

    const masterOnly = sharedConnection.duplicate([], { scaleReads: "master" });
    if (masterOnly.status !== "ready") {
      try {
        await waitForClusterReady(masterOnly);
      } catch (error) {
        try {
          masterOnly.disconnect();
        } catch (cleanupError) {
          logger?.error(
            { error: cleanupError },
            "failed to close cutover-audit Redis duplicate after handshake failure",
          );
        }
        throw error;
      }
    }

    return {
      redis: masterOnly,
      scanNodes: masterOnly.nodes("master"),
      cleanup: () => masterOnly.disconnect(),
    };
  }

  static create(input: {
    config: MigrationCutoverRedisConfig;
    logger: RedisLogger;
    createLease?: MigrationCutoverAuditLeaseFactory;
  }): MigrationCutoverRedisAuditAdapter {
    return new MigrationCutoverRedisAuditAdapter(
      input.config,
      input.logger,
      input.createLease ?? MigrationCutoverRedisAuditAdapter.createAuditLease,
    );
  }

  private constructor(
    private readonly config: MigrationCutoverRedisConfig,
    private readonly logger: RedisLogger,
    private readonly createLease: MigrationCutoverAuditLeaseFactory,
  ) {}

  async audit(): Promise<QueueMigrationBlocker[]> {
    const connection = new RedisConnectionService({ logger: this.logger }).connect(this.config);
    if (!connection) {
      throw new Error("Redis is required to audit GroupQueue before migration finalization");
    }

    let audit: MigrationCutoverAuditLease | undefined;
    let operationFailed = false;
    let firstCloseFailure: unknown;
    try {
      audit = await this.createLease(connection, this.logger);
      return await GroupQueueObjectStorageMigrationAdapter.audit({
        redis: audit.redis,
        scanNodes: audit.scanNodes,
      });
    } catch (error) {
      operationFailed = true;
      throw error;
    } finally {
      try {
        audit?.cleanup();
      } catch (error) {
        firstCloseFailure = error;
        this.logger.error({ error }, "failed to close cutover-audit Redis duplicate");
      }
      try {
        connection.disconnect();
      } catch (error) {
        firstCloseFailure ??= error;
        this.logger.error({ error }, "failed to close cutover-audit Redis connection");
      }
      if (!operationFailed && firstCloseFailure) {
        throw firstCloseFailure;
      }
    }
  }
}

const CUTOVER_AUDIT_HANDSHAKE_TIMEOUT_MS = 30_000;

function waitForClusterReady(cluster: Cluster): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          `Timed out after ${CUTOVER_AUDIT_HANDSHAKE_TIMEOUT_MS}ms waiting for the cutover-audit Redis connection to become ready`,
        ),
      );
    }, CUTOVER_AUDIT_HANDSHAKE_TIMEOUT_MS);
    const settle = (error?: Error) => {
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };
    cluster.once("ready", () => settle());
    cluster.once("error", (error: Error) => settle(error));
  });
}
