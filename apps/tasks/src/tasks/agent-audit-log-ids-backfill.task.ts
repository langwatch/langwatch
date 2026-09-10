import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { Redis, Cluster } from "ioredis";
import { Task } from "@langwatch/task";
import { createLogger } from "@langwatch/observability";
import { createAgentAuditLogIdsMigration } from "@langwatch/enterprise-audit-log-server";
import { OpsSystemMigrations } from "@langwatch/ops-server";

const logger = createLogger("langwatch:task:agent-audit-log-ids-backfill");

export class AgentAuditLogIdsBackfillTask extends Task {
  readonly name = "agent-audit-log-ids-backfill";
  readonly description = "Repairs missing agent IDs in audit history. Dry-run unless --execute.";
  readonly #database: () => PrismaClient;
  readonly #redis: Redis | Cluster | null;

  private constructor(database: () => PrismaClient, redis: Redis | Cluster | null) {
    super();
    this.#database = database;
    this.#redis = redis;
  }

  static create({
    database,
    redis,
  }: {
    database: () => PrismaClient;
    redis: Redis | Cluster | null;
  }) {
    return new AgentAuditLogIdsBackfillTask(database, redis);
  }

  async run({ args, signal }: { args: readonly string[]; signal: AbortSignal }): Promise<void> {
    const database = this.#database();
    const migration = createAgentAuditLogIdsMigration(database);
    if (!args.includes("--execute")) {
      logger.info(
        { report: await migration.run({ execute: false, signal }) },
        "agent audit-log id repair preview",
      );
      return;
    }
    if (!this.#redis) throw new Error("Redis is required to lease the audit-log migration.");

    const runner = OpsSystemMigrations.create({
      database,
      redis: this.#redis,
      isSaaS: () => false,
      tenantAxis: "project",
      migrations: () => [migration],
      userMigrations: () => [],
      newbornSweep: async () => {},
    });
    const report = await runner.runPass({ signal });
    logger.info({ report }, "agent audit-log id repair pass finished");
    if (report.held || report.parked || report.claimed)
      throw new Error(
        "Audit-log migration remains incomplete; inspect the persisted migration report.",
      );
  }
}
