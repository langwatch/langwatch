import { createLogger } from "@langwatch/observability";
import { Task } from "@langwatch/task";

import type { AgentAuditLogIdsService } from "../services/agent-audit-log-ids.service.ts";

const logger = createLogger("langwatch:tasks:agent-audit-log-ids-backfill");

/** What the task needs of the repair, and nothing more. */
export type AgentAuditLogRepair = Pick<AgentAuditLogIdsService, "repair">;

/**
 * The task-launcher entry for main's `scripts/backfill-agent-audit-log-ids.ts`:
 * `pnpm --filter @langwatch/tasks task agent-audit-log-ids-backfill [--dry-run]`.
 * It writes by default, as main's script did; `--dry-run` reports without writing.
 */
export class AgentAuditLogIdsTask extends Task {
  readonly name = "agent-audit-log-ids-backfill";
  readonly description =
    "Adds the missing agent id to pre-fix agents.create and agents.copy audit entries.";

  private constructor(private readonly repair: () => AgentAuditLogRepair) {
    super();
  }

  static create({ repair }: { repair: () => AgentAuditLogRepair }): AgentAuditLogIdsTask {
    return new AgentAuditLogIdsTask(repair);
  }

  async run({ args, signal }: { args: readonly string[]; signal: AbortSignal }): Promise<void> {
    const report = await this.repair().repair({ execute: !args.includes("--dry-run"), signal });
    logger.info(report, "Finished the agent audit-log id backfill");
  }
}
