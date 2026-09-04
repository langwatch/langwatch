import { describe, expect, it, vi } from "vitest";
import {
  backfillAgentAuditLogIds,
  type AgentAuditLogBackfillDatabase,
} from "../agent-audit-log-ids-backfill.task";

const AT = new Date("2026-08-01T12:00:00Z");

/**
 * `AgentAuditLogBackfillDatabase` picks real delegate methods, which return
 * branded `PrismaPromise` values, so the double is built untyped and cast once
 * at the seam — the pattern `user-data-erase.task.unit.test.ts` uses.
 */
function fakeDatabase({
  logs,
  agentsFor,
}: {
  logs: Record<string, Array<{ id: string; projectId: string | null; args: unknown }>>;
  agentsFor: (where: Record<string, unknown>) => Array<{ id: string }>;
}) {
  const updates: Array<{ id: string; args: Record<string, unknown> }> = [];
  const findManyLogs = vi.fn(async ({ where }: { where: { action: string } }) =>
    (logs[where.action] ?? []).map((log) => ({ ...log, createdAt: AT })),
  );
  const updateLog = vi.fn(
    async ({ where, data }: { where: { id: string }; data: { args: Record<string, unknown> } }) => {
      updates.push({ id: where.id, args: data.args });
    },
  );
  const findManyAgents = vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
    agentsFor(where),
  );
  const database = {
    auditLog: { findMany: findManyLogs, update: updateLog },
    agent: { findMany: findManyAgents },
  } as unknown as AgentAuditLogBackfillDatabase;
  return { database, updates, findManyAgents };
}

describe("backfillAgentAuditLogIds", () => {
  describe("given a pre-fix record with exactly one candidate agent", () => {
    /** @scenario "The audit-log backfill fills in the agent id of a pre-fix record" */
    it("writes that agent's id, and matches a copy by its source agent", async () => {
      const { database, updates, findManyAgents } = fakeDatabase({
        logs: {
          "agents.create": [{ id: "log-create", projectId: "project-1", args: {} }],
          "agents.copy": [
            { id: "log-copy", projectId: "project-1", args: { agentId: "source-1" } },
          ],
        },
        agentsFor: (where) => [{ id: where.copiedFromAgentId ? "agent-copy" : "agent-new" }],
      });

      const outcome = await backfillAgentAuditLogIds({ database, execute: true });

      expect(outcome.mode).toBe("execute");
      expect(updates).toEqual([
        { id: "log-create", args: { id: "agent-new" } },
        { id: "log-copy", args: { agentId: "source-1", newAgentId: "agent-copy" } },
      ]);
      expect(findManyAgents.mock.calls[1]?.[0].where.copiedFromAgentId).toBe("source-1");
    });
  });

  describe("when the window matches more than one agent, or the log has no project", () => {
    /** @scenario "The audit-log backfill leaves an ambiguous record untouched" */
    it("skips and counts them, writing nothing", async () => {
      const { database, updates } = fakeDatabase({
        logs: {
          "agents.create": [
            { id: "log-ambiguous", projectId: "project-1", args: {} },
            { id: "log-no-project", projectId: null, args: {} },
          ],
        },
        agentsFor: () => [{ id: "agent-a" }, { id: "agent-b" }],
      });

      const outcome = await backfillAgentAuditLogIds({ database, execute: true });

      const create = outcome.actions.find((action) => action.action === "agents.create");
      expect(create).toEqual({ action: "agents.create", missing: 2, patched: 0, skipped: 2 });
      expect(updates).toEqual([]);
    });
  });
});
