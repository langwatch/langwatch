import { auditLogJsonValueSchema } from "@langwatch/audit-log-contract";
import type { SystemMigration, TenantMigrationOutcome } from "@langwatch/system-migrations";
import { z } from "zod";

import type {
  AgentAuditLogMigrationRepository,
  AgentAuditLogRow,
} from "../repositories/agent-audit-log-migration.repository.ts";
import {
  PrismaAgentAuditLogMigrationRepository,
  type AgentAuditLogMigrationDatabase,
} from "../repositories/prisma/prisma.agent-audit-log-migration.repository.ts";

const argsSchema = z.record(z.string(), auditLogJsonValueSchema);
const WINDOW_MS = 60_000;

export function createAgentAuditLogIdsMigration(
  database: AgentAuditLogMigrationDatabase,
): AgentAuditLogIdsMigration {
  return AgentAuditLogIdsMigration.create(PrismaAgentAuditLogMigrationRepository.create(database));
}
const repairs = [
  { action: "agents.create", missingKey: "id" },
  { action: "agents.copy", missingKey: "newAgentId" },
] as const;

export type AgentAuditLogBackfillOutcome = {
  mode: "dry-run" | "execute";
  actions: { action: string; missing: number; patched: number; skipped: number }[];
};

export class AgentAuditLogIdsMigration implements SystemMigration {
  readonly name = "agent-audit-log-ids-backfill";
  readonly title = "Recover generated agent identifiers in audit history";
  readonly description =
    "Links legacy create/copy audit entries only when one project-scoped agent matches.";
  readonly executionMode = "background";
  readonly requiresOperatorConfirmation = false;
  readonly runsAutomaticallyOnSelfHosted = true;
  readonly enrolledAutomatically = true;
  readonly #repository: AgentAuditLogMigrationRepository;

  private constructor(repository: AgentAuditLogMigrationRepository) {
    this.#repository = repository;
  }

  static create(repository: AgentAuditLogMigrationRepository): AgentAuditLogIdsMigration {
    return new AgentAuditLogIdsMigration(repository);
  }

  async migrateTenant({
    tenantId,
    signal,
  }: {
    tenantId: string;
    signal?: AbortSignal;
  }): Promise<TenantMigrationOutcome> {
    const report = await this.run({ execute: true, projectId: tenantId, signal });
    const skipped = report.actions.some((action) => action.skipped > 0);
    return { status: skipped ? ("migrated" as const) : ("finalized" as const), report };
  }

  async run(input: {
    execute: boolean;
    projectId?: string;
    signal?: AbortSignal;
  }): Promise<AgentAuditLogBackfillOutcome> {
    const actions = [];
    for (const repair of repairs) {
      input.signal?.throwIfAborted();
      actions.push(await this.repairLogs(repair, input));
    }

    return { mode: input.execute ? "execute" : "dry-run", actions };
  }

  private async repairLogs(
    repair: (typeof repairs)[number],
    input: { execute: boolean; projectId?: string; signal?: AbortSignal },
  ) {
    const logs = await this.#repository.listLogs({
      action: repair.action,
      projectId: input.projectId,
    });
    const result = { action: repair.action, missing: 0, patched: 0, skipped: 0 };

    for (const log of logs) {
      input.signal?.throwIfAborted();
      const outcome = await this.repairLog(log, repair, input.execute);
      if (outcome === "already-present") continue;
      result.missing += 1;
      if (outcome === "skipped") result.skipped += 1;
      if (outcome === "patched") {
        result.patched += 1;
      }
    }

    return result;
  }

  private async repairLog(
    log: AgentAuditLogRow,
    repair: (typeof repairs)[number],
    execute: boolean,
  ): Promise<"already-present" | "missing" | "skipped" | "patched"> {
    const parsed = argsSchema.safeParse(log.args);
    const args = parsed.success ? parsed.data : {};
    if (args[repair.missingKey] !== void 0) return "already-present";

    const source = args.agentId;
    const isCopy = repair.action === "agents.copy";
    if (!log.projectId || (isCopy && (typeof source !== "string" || source === ""))) {
      return "skipped";
    }

    const matches = await this.#repository.listCandidates({
      projectId: log.projectId,
      window: {
        gte: log.createdAt.subtract({ milliseconds: WINDOW_MS }),
        lte: log.createdAt.add({ milliseconds: WINDOW_MS }),
      },
      ...(isCopy && typeof source === "string" ? { copiedFromAgentId: source } : {}),
    });
    const candidate = matches.length === 1 ? matches[0] : void 0;
    if (!candidate) return "skipped";

    if (execute) {
      await this.#repository.updateArgs({
        logId: log.id,
        projectId: log.projectId,
        args: { ...args, [repair.missingKey]: candidate.id },
      });
    }
    return "patched";
  }
}
