import { describe, expect, it, vi } from "vitest";
import type {
  AgentAuditLogCandidateQuery,
  AgentAuditLogMigrationRepository,
  AgentAuditLogRow,
} from "../../repositories/agent-audit-log-migration.repository.ts";
import { AgentAuditLogIdsMigration } from "../agent-audit-log-ids.migration.ts";

const at = new Date("2026-08-01T12:00:00Z");

function fixture(
  logs: Record<string, AgentAuditLogRow[]>,
  candidates: (query: AgentAuditLogCandidateQuery) => { id: string }[],
) {
  const listLogs = vi.fn(async ({ action, projectId }: { action: string; projectId?: string }) =>
    (logs[action] ?? []).filter((log) => !projectId || log.projectId === projectId),
  );
  const listCandidates = vi.fn(async (query: AgentAuditLogCandidateQuery) => candidates(query));
  const updateArgs = vi.fn<AgentAuditLogMigrationRepository["updateArgs"]>(
    async ({ logId, args }) => {
      for (const entries of Object.values(logs)) {
        const log = entries.find((entry) => entry.id === logId);
        if (log) log.args = args;
      }
    },
  );
  const repository = {
    listLogs,
    listCandidates,
    updateArgs,
  } satisfies AgentAuditLogMigrationRepository;

  return { migration: AgentAuditLogIdsMigration.create(repository), listCandidates, updateArgs };
}

describe("agent audit identifier migration", () => {
  /** @scenario "Legacy agent audit identifiers are repaired without guessing" */
  /** @scenario "The audit-log backfill fills in the agent id of a pre-fix record" */
  it("repairs unique create/copy candidates and leaves a repeated pass unchanged", async () => {
    const { migration, listCandidates, updateArgs } = fixture(
      {
        "agents.create": [{ id: "create", projectId: "project-1", args: {}, createdAt: at }],
        "agents.copy": [
          { id: "copy", projectId: "project-1", args: { agentId: "source" }, createdAt: at },
        ],
      },
      (query) => [{ id: query.copiedFromAgentId ? "copied" : "created" }],
    );

    expect((await migration.migrateTenant({ tenantId: "project-1" })).status).toBe("finalized");
    expect(updateArgs.mock.calls.map(([input]) => input)).toEqual([
      { logId: "create", projectId: "project-1", args: { id: "created" } },
      { logId: "copy", projectId: "project-1", args: { agentId: "source", newAgentId: "copied" } },
    ]);
    expect(listCandidates).toHaveBeenCalledWith({
      projectId: "project-1",
      copiedFromAgentId: "source",
      window: { gte: new Date(at.getTime() - 60000), lte: new Date(at.getTime() + 60000) },
    });
    await migration.migrateTenant({ tenantId: "project-1" });
    expect(updateArgs).toHaveBeenCalledTimes(2);
  });

  /** @scenario "The audit-log backfill leaves an ambiguous record untouched" */
  it("holds ambiguous records and skips projectless history instead of guessing", async () => {
    const { migration, updateArgs } = fixture(
      {
        "agents.create": [
          { id: "ambiguous", projectId: "project-1", args: {}, createdAt: at },
          { id: "projectless", projectId: null, args: {}, createdAt: at },
        ],
      },
      () => [{ id: "first" }, { id: "second" }],
    );

    expect((await migration.run({ execute: true })).actions[0]).toEqual({
      action: "agents.create",
      missing: 2,
      patched: 0,
      skipped: 2,
    });
    expect((await migration.migrateTenant({ tenantId: "project-1" })).status).toBe("migrated");
    expect(updateArgs).not.toHaveBeenCalled();
  });

  /** @scenario "The legacy audit repair is explicitly invoked" */
  it("previews changes without writing and scopes a tenant pass away from another project", async () => {
    const { migration, updateArgs } = fixture(
      {
        "agents.create": [
          { id: "one", projectId: "project-1", args: {}, createdAt: at },
          { id: "two", projectId: "project-2", args: {}, createdAt: at },
        ],
      },
      () => [{ id: "created" }],
    );

    expect((await migration.run({ execute: false })).actions[0]?.patched).toBe(2);
    expect(updateArgs).not.toHaveBeenCalled();
    await migration.migrateTenant({ tenantId: "project-1" });
    expect(updateArgs).toHaveBeenCalledExactlyOnceWith({
      logId: "one",
      projectId: "project-1",
      args: { id: "created" },
    });
  });

  it("does not query after cancellation", async () => {
    const { migration, listCandidates, updateArgs } = fixture({}, () => []);
    await expect(
      migration.migrateTenant({ tenantId: "project-1", signal: AbortSignal.abort() }),
    ).rejects.toThrow();
    expect(listCandidates).not.toHaveBeenCalled();
    expect(updateArgs).not.toHaveBeenCalled();
  });
});
