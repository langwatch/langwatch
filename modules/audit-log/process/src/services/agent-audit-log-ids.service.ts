import type { AgentApi } from "@langwatch/agent-contract";
import { auditLogJsonValueSchema } from "@langwatch/audit-log-contract";
import { z } from "zod";

import type {
  AgentAuditLogMigrationRepository,
  AgentAuditLogRow,
} from "../repositories/agent-audit-log-migration.repository.ts";

const argsSchema = z.record(z.string(), auditLogJsonValueSchema);
const WINDOW_MS = 60_000;

const repairs = [
  { action: "agents.create", missingKey: "id" },
  { action: "agents.copy", missingKey: "newAgentId" },
] as const;

type Repair = (typeof repairs)[number];

export type AgentAuditLogRepairReport = {
  mode: "dry-run" | "execute";
  actions: { action: string; missing: number; patched: number; skipped: number }[];
};

/**
 * Main's `backfill-agent-audit-log-ids.ts`: gives a pre-fix agents.create or agents.copy
 * audit entry the agent id it never recorded, but only when exactly one agent in the entry's
 * project matches its one-minute window. A guessed id is worse than a missing one.
 */
export class AgentAuditLogIdsService {
  private constructor(
    private readonly logs: AgentAuditLogMigrationRepository,
    private readonly agents: Pick<AgentApi, "findIdsCreatedInWindow">,
  ) {}

  static create({
    logs,
    agents,
  }: {
    logs: AgentAuditLogMigrationRepository;
    agents: Pick<AgentApi, "findIdsCreatedInWindow">;
  }): AgentAuditLogIdsService {
    return new AgentAuditLogIdsService(logs, agents);
  }

  async repair(input: {
    execute: boolean;
    signal?: AbortSignal;
  }): Promise<AgentAuditLogRepairReport> {
    const actions = [];
    for (const repair of repairs) {
      input.signal?.throwIfAborted();
      actions.push(await this.repairLogs(repair, input));
    }

    return { mode: input.execute ? "execute" : "dry-run", actions };
  }

  private async repairLogs(repair: Repair, input: { execute: boolean; signal?: AbortSignal }) {
    const logs = await this.logs.findLogs({ action: repair.action });
    const result = { action: repair.action, missing: 0, patched: 0, skipped: 0 };

    for (const log of logs) {
      input.signal?.throwIfAborted();
      const outcome = await this.repairLog(log, repair, input.execute);
      if (outcome === "already-present") continue;
      result.missing += 1;
      if (outcome === "skipped") result.skipped += 1;
      if (outcome === "patched") result.patched += 1;
    }

    return result;
  }

  private async repairLog(
    log: AgentAuditLogRow,
    repair: Repair,
    execute: boolean,
  ): Promise<"already-present" | "skipped" | "patched"> {
    const parsed = argsSchema.safeParse(log.args);
    const args = parsed.success ? parsed.data : {};
    if (args[repair.missingKey] !== void 0) return "already-present";

    const source = args.agentId;
    const isCopy = repair.action === "agents.copy";
    if (!log.projectId || (isCopy && (typeof source !== "string" || source === ""))) {
      return "skipped";
    }

    const matches = await this.agents.findIdsCreatedInWindow({
      projectId: log.projectId,
      from: log.createdAt.subtract({ milliseconds: WINDOW_MS }),
      to: log.createdAt.add({ milliseconds: WINDOW_MS }),
      ...(isCopy && typeof source === "string" ? { copiedFromAgentId: source } : {}),
    });
    const agentId = matches.length === 1 ? matches[0] : void 0;
    if (!agentId) return "skipped";

    if (execute) {
      await this.logs.updateArgs({
        logId: log.id,
        projectId: log.projectId,
        args: { ...args, [repair.missingKey]: agentId },
      });
    }
    return "patched";
  }
}
