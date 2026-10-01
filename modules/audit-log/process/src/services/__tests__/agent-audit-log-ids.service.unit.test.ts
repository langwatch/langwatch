import type { AgentApi, AgentCreationWindowInput } from "@langwatch/agent-contract";
import type { AuditLogJsonValue } from "@langwatch/audit-log-contract";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import type {
  AgentAuditLogMigrationRepository,
  AgentAuditLogRow,
} from "../../repositories/agent-audit-log-migration.repository.ts";
import { AgentAuditLogIdsService } from "../agent-audit-log-ids.service.ts";

const at = Temporal.Instant.from("2026-08-01T12:00:00Z");

type Patch = { logId: string; projectId: string; args: Record<string, AuditLogJsonValue> };

/** Audit rows by action, and the agent ids each creation-window query answers. */
class ScriptedAgentAuditLogs
  implements AgentAuditLogMigrationRepository, Pick<AgentApi, "findIdsCreatedInWindow">
{
  readonly queries: AgentCreationWindowInput[] = [];
  readonly patches: Patch[] = [];

  constructor(
    private readonly logs: Record<string, AgentAuditLogRow[]>,
    private readonly candidates: (query: AgentCreationWindowInput) => string[],
  ) {}

  async findLogs({ action }: { action: string }): Promise<AgentAuditLogRow[]> {
    return this.logs[action] ?? [];
  }

  async findIdsCreatedInWindow(query: AgentCreationWindowInput): Promise<string[]> {
    this.queries.push(query);
    return this.candidates(query);
  }

  async updateArgs(patch: Patch): Promise<void> {
    this.patches.push(patch);
    for (const entries of Object.values(this.logs)) {
      const log = entries.find((entry) => entry.id === patch.logId);
      if (log) log.args = patch.args;
    }
  }
}

describe("given pre-fix agent audit entries without the generated agent id", () => {
  describe("when the backfill runs and is told to execute", () => {
    /** @scenario "Legacy agent audit identifiers are repaired without guessing" */
    /** @scenario "The audit-log backfill fills in the agent id of a pre-fix record" */
    it("links the one candidate, matching a copy by its source, and a second pass writes nothing", async () => {
      const logs = new ScriptedAgentAuditLogs(
        {
          "agents.create": [{ id: "create", projectId: "project-1", args: {}, createdAt: at }],
          "agents.copy": [
            { id: "copy", projectId: "project-1", args: { agentId: "source" }, createdAt: at },
          ],
        },
        (query) => [query.copiedFromAgentId ? "copied" : "created"],
      );
      const service = AgentAuditLogIdsService.create({ logs, agents: logs });

      await service.repair({ execute: true });
      await service.repair({ execute: true });

      expect(logs.patches).toEqual([
        { logId: "create", projectId: "project-1", args: { id: "created" } },
        {
          logId: "copy",
          projectId: "project-1",
          args: { agentId: "source", newAgentId: "copied" },
        },
      ]);
      expect(logs.queries).toContainEqual({
        projectId: "project-1",
        copiedFromAgentId: "source",
        from: at.subtract({ milliseconds: 60_000 }),
        to: at.add({ milliseconds: 60_000 }),
      });
    });
  });

  describe("when an entry matches more than one agent or has no project", () => {
    /** @scenario "The audit-log backfill leaves an ambiguous record untouched" */
    it("skips and counts it, writing nothing", async () => {
      const logs = new ScriptedAgentAuditLogs(
        {
          "agents.create": [
            { id: "ambiguous", projectId: "project-1", args: {}, createdAt: at },
            { id: "projectless", projectId: null, args: {}, createdAt: at },
          ],
        },
        () => ["first", "second"],
      );

      const report = await AgentAuditLogIdsService.create({ logs, agents: logs }).repair({
        execute: true,
      });

      expect(report.actions[0]).toEqual({
        action: "agents.create",
        missing: 2,
        patched: 0,
        skipped: 2,
      });
      expect(logs.patches).toEqual([]);
    });
  });

  describe("when the backfill runs as a dry run", () => {
    /** @scenario "The legacy audit repair is explicitly invoked" */
    it("reports what it would link without writing", async () => {
      const logs = new ScriptedAgentAuditLogs(
        { "agents.create": [{ id: "one", projectId: "project-1", args: {}, createdAt: at }] },
        () => ["created"],
      );

      const report = await AgentAuditLogIdsService.create({ logs, agents: logs }).repair({
        execute: false,
      });

      expect(report).toMatchObject({ mode: "dry-run", actions: [{ patched: 1 }, { patched: 0 }] });
      expect(logs.patches).toEqual([]);
    });
  });

  describe("when the run is cancelled", () => {
    it("queries nothing", async () => {
      const logs = new ScriptedAgentAuditLogs({}, () => []);

      await expect(
        AgentAuditLogIdsService.create({ logs, agents: logs }).repair({
          execute: true,
          signal: AbortSignal.abort(),
        }),
      ).rejects.toMatchObject({ name: "AbortError" });
      expect(logs.queries).toEqual([]);
    });
  });
});
