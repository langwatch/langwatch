import { describe, expect, it, vi } from "vitest";
import { backfillAgentAuditLogIds } from "../agent-audit-log-ids-backfill.task.ts";
import type { AgentAuditLogBackfillRepository } from "../../repositories/prisma/prisma.agent-audit-log-backfill.repository.ts";

const AT = new Date("2026-08-01T12:00:00Z");

/**
 * A repository double built untyped and cast once at the seam — the pattern
 * `user-data-erase.task.unit.test.ts` uses for its own repository double.
 */
function fakeRepository({
  logs,
  agentsFor,
}: {
  logs: Record<string, Array<{ id: string; projectId: string | null; args: unknown }>>;
  agentsFor: (where: Record<string, unknown>) => Array<{ id: string }>;
}) {
  const updates: Array<{ id: string; args: Record<string, unknown> }> = [];
  const findLogsByAction = vi.fn(async (action: string) =>
    (logs[action] ?? []).map((log) => ({ ...log, createdAt: AT })),
  );
  const patchLogArgs = vi.fn(
    async ({ logId, args }: { logId: string; args: Record<string, unknown> }) => {
      updates.push({ id: logId, args });
    },
  );
  const findCandidateAgents = vi.fn(async (where: Record<string, unknown>) => agentsFor(where));
  const repository = {
    findLogsByAction,
    patchLogArgs,
    findCandidateAgents,
  } as unknown as AgentAuditLogBackfillRepository;
  return { repository, updates, findCandidateAgents };
}

describe("backfillAgentAuditLogIds", () => {
  describe("given a pre-fix record with exactly one candidate agent", () => {
    /** @scenario "The audit-log backfill fills in the agent id of a pre-fix record" */
    it("writes that agent's id, and matches a copy by its source agent", async () => {
      const { repository, updates, findCandidateAgents } = fakeRepository({
        logs: {
          "agents.create": [{ id: "log-create", projectId: "project-1", args: {} }],
          "agents.copy": [
            { id: "log-copy", projectId: "project-1", args: { agentId: "source-1" } },
          ],
        },
        agentsFor: (where) => [{ id: where.copiedFromAgentId ? "agent-copy" : "agent-new" }],
      });

      const outcome = await backfillAgentAuditLogIds({ repository, execute: true });

      expect(outcome.mode).toBe("execute");
      expect(updates).toEqual([
        { id: "log-create", args: { id: "agent-new" } },
        { id: "log-copy", args: { agentId: "source-1", newAgentId: "agent-copy" } },
      ]);
      expect(findCandidateAgents.mock.calls[1]?.[0].copiedFromAgentId).toBe("source-1");
    });
  });

  describe("when the window matches more than one agent, or the log has no project", () => {
    /** @scenario "The audit-log backfill leaves an ambiguous record untouched" */
    it("skips and counts them, writing nothing", async () => {
      const { repository, updates } = fakeRepository({
        logs: {
          "agents.create": [
            { id: "log-ambiguous", projectId: "project-1", args: {} },
            { id: "log-no-project", projectId: null, args: {} },
          ],
        },
        agentsFor: () => [{ id: "agent-a" }, { id: "agent-b" }],
      });

      const outcome = await backfillAgentAuditLogIds({ repository, execute: true });

      const create = outcome.actions.find((action) => action.action === "agents.create");
      expect(create).toEqual({ action: "agents.create", missing: 2, patched: 0, skipped: 2 });
      expect(updates).toEqual([]);
    });
  });
});
