import { AuditLogApi } from "@langwatch/audit-log-contract";
import { createApp } from "@langwatch/runtime-composition";
import { describe, expect, it } from "vitest";
import { auditLogServer } from "../../audit-log.server.ts";

function process() {
  return createApp({ name: "audit-log-installation-test" })
    .withPersistence("memory", {})
    .withInfrastructure({})
    .withFeature(auditLogServer);
}

const command = {
  userId: "user-1",
  projectId: "project-1",
  action: "agents.create",
  args: { id: "agent-1" },
};

describe("given a process that installed the audit log", () => {
  describe("when a management write is recorded", () => {
    /** @scenario "A recorded entry is readable as the entity's history" */
    it.each(["api", "worker"] as const)("reads it back as history in the %s role", async (role) => {
      const runtime = await process().boot({
        role,
        config: { "audit-log": { maxArgsBytes: 4 * 1024 } },
      });

      try {
        const app = runtime.service(AuditLogApi);
        expect(runtime.feature(auditLogServer).provided).toBe(app);

        await app.record(command);

        await expect(
          app.listEntityHistory({
            projectId: "project-1",
            actionPrefix: "agents.",
            entityId: "agent-1",
            argumentNames: ["id", "agentId", "newAgentId"],
            limit: 10,
          }),
        ).resolves.toMatchObject([{ userId: "user-1", action: "agents.create" }]);
      } finally {
        await runtime.stop();
      }
    });

    /** @scenario "Entity history stays inside the requested project and action family" */
    it("answers nothing for another project or another action family", async () => {
      const runtime = await process().boot({
        role: "api",
        config: { "audit-log": { maxArgsBytes: 4 * 1024 } },
      });

      try {
        const app = runtime.service(AuditLogApi);
        await app.record(command);

        await expect(
          app.listEntityHistory({
            projectId: "other-project",
            actionPrefix: "agents.",
            entityId: "agent-1",
            argumentNames: ["id"],
            limit: 10,
          }),
        ).resolves.toEqual([]);

        await expect(
          app.listEntityHistory({
            projectId: "project-1",
            actionPrefix: "projects.",
            entityId: "agent-1",
            argumentNames: ["id"],
            limit: 10,
          }),
        ).resolves.toEqual([]);
      } finally {
        await runtime.stop();
      }
    });
  });
});
