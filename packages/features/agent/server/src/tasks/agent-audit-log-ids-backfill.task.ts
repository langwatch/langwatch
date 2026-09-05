import { createLogger } from "@langwatch/observability";
import { Task } from "@langwatch/task";
import type {
  AgentAuditLogArgs,
  AgentAuditLogArgsInput,
  AgentAuditLogArgsValue,
  AgentAuditLogBackfillDatabase,
  AgentAuditLogRow,
} from "../repositories/prisma/prisma.agent-audit-log-backfill.repository";

const logger = createLogger("langwatch:task:agent-audit-log-ids-backfill");

/** How far either side of the audit log a candidate agent may have been
 *  created. Wide enough for a slow write, narrow enough that two agents
 *  created in the same project inside it are genuinely ambiguous. */
const WINDOW_MS = 60_000;

export type AgentAuditLogBackfillOutcome = Readonly<{
  mode: "dry-run" | "execute";
  actions: ReadonlyArray<{ action: string; missing: number; patched: number; skipped: number }>;
}>;

/**
 * Repairs `agents.create` and `agents.copy` audit logs written before the
 * generated agent id was recorded in `args`, which left those events invisible
 * in the history drawer. Ported from main's `backfill-agent-audit-log-ids.ts`.
 */
export async function backfillAgentAuditLogIds({
  database,
  execute,
}: {
  database: AgentAuditLogBackfillDatabase;
  execute: boolean;
}): Promise<AgentAuditLogBackfillOutcome> {
  const create = await backfillAction({
    database,
    execute,
    action: "agents.create",
    missingKey: "id",
    candidates: ({ log }) => ({ projectId: log.projectId ?? "", window: windowOf(log) }),
  });
  const copy = await backfillAction({
    database,
    execute,
    action: "agents.copy",
    missingKey: "newAgentId",
    // A copy names its source, so the match is exact rather than positional:
    // the window only disambiguates two copies of the same source agent.
    candidates: ({ log, args }) => {
      const source = args.agentId;
      if (typeof source !== "string" || source === "") return null;
      return { projectId: log.projectId ?? "", window: windowOf(log), copiedFromAgentId: source };
    },
  });
  return { mode: execute ? "execute" : "dry-run", actions: [create, copy] };
}

function windowOf(log: AgentAuditLogRow): { gte: Date; lte: Date } {
  return {
    gte: new Date(log.createdAt.getTime() - WINDOW_MS),
    lte: new Date(log.createdAt.getTime() + WINDOW_MS),
  };
}

/**
 * A log is only patched when exactly one agent matches. Zero and several are
 * both skipped and counted: guessing which agent an event meant would write a
 * wrong id into the audit trail, which is worse than the missing one.
 */
async function backfillAction({
  database,
  execute,
  action,
  missingKey,
  candidates,
}: {
  database: AgentAuditLogBackfillDatabase;
  execute: boolean;
  action: string;
  missingKey: string;
  candidates: (input: { log: AgentAuditLogRow; args: AgentAuditLogArgs }) => {
    projectId: string;
    window: { gte: Date; lte: Date };
    copiedFromAgentId?: string;
  } | null;
}): Promise<{ action: string; missing: number; patched: number; skipped: number }> {
  const logs = await database.auditLog.findMany({
    where: { action },
    select: { id: true, projectId: true, createdAt: true, args: true },
  });
  const missing = logs.filter((log) => argsOf(log)[missingKey] === undefined);

  let patched = 0;
  let skipped = 0;
  for (const log of missing) {
    const args = argsOf(log);
    const query = log.projectId ? candidates({ log, args }) : null;
    if (!query) {
      skipped += 1;
      continue;
    }
    const matches = await database.agent.findMany({
      where: {
        projectId: query.projectId,
        createdAt: query.window,
        copiedFromAgentId: query.copiedFromAgentId,
      },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    const only = matches.length === 1 ? matches[0] : undefined;
    if (!only) {
      skipped += 1;
      logger.warn(
        { logId: log.id, action, matches: matches.length },
        "no single agent matches this audit log; leaving it untouched",
      );
      continue;
    }
    if (execute) {
      await database.auditLog.update({
        where: { id: log.id },
        data: { args: { ...args, [missingKey]: only.id } as AgentAuditLogArgsInput },
      });
    }
    patched += 1;
  }

  logger.info({ action, missing: missing.length, patched, skipped }, "audit log backfill pass");
  return { action, missing: missing.length, patched, skipped };
}

/** `args` is a nullable Json column, so anything but an object reads as
 *  empty rather than throwing — a malformed row is skipped, not crashed on. */
function argsOf(log: AgentAuditLogRow): AgentAuditLogArgs {
  const args: AgentAuditLogArgsValue | null = log.args;
  return typeof args === "object" && args !== null && !Array.isArray(args) ? args : {};
}

/**
 * The task-launcher entry — `pnpm --filter @langwatch/tasks task
 * agent-audit-log-ids-backfill -- --execute`.
 */
export class AgentAuditLogIdsBackfillTask extends Task {
  readonly name = "agent-audit-log-ids-backfill";
  readonly description =
    "Adds the missing agent id to pre-fix agents.create and agents.copy audit logs. Dry-run unless --execute.";

  private constructor(private readonly database: () => AgentAuditLogBackfillDatabase) {
    super();
  }

  static create({
    database,
  }: {
    database: () => AgentAuditLogBackfillDatabase;
  }): AgentAuditLogIdsBackfillTask {
    return new AgentAuditLogIdsBackfillTask(database);
  }

  async run({ args }: { args: readonly string[]; signal: AbortSignal }): Promise<void> {
    const outcome = await backfillAgentAuditLogIds({
      database: this.database(),
      execute: args.includes("--execute"),
    });
    logger.info({ outcome }, "agent audit-log id backfill finished");
  }
}
