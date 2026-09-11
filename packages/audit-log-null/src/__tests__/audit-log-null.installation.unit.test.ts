import { AuditLogApi } from "@langwatch/audit-log-contract";
import { createApp, withMemoryRepositories } from "@langwatch/runtime-composition";
import { describe, expect, it } from "vitest";
import { auditLogNullServer } from "../audit-log-null.server.ts";

describe("given a process that installed no Enterprise audit log", () => {
  describe("when a management write is recorded", () => {
    /** @scenario "An installation without the Enterprise audit log records nothing" */
    it.each(["api", "worker"] as const)(
      "accepts the write and answers an empty history in the %s role",
      async (role) => {
        const runtime = await createApp({ role: "api", config: {} })
          .withModules([withMemoryRepositories(auditLogNullServer)])
          .boot();

        try {
          const app = runtime.service(AuditLogApi);

          expect(runtime.module(auditLogNullServer).provided).toBe(app);
          await expect(
            app.record({ userId: "user-1", action: "agents.create", args: { id: "agent-1" } }),
          ).resolves.toBeUndefined();
          await expect(
            app.listEntityHistory({
              projectId: "project-1",
              actionPrefix: "agents.",
              entityId: "agent-1",
              argumentNames: ["id"],
              limit: 10,
            }),
          ).resolves.toEqual([]);
        } finally {
          await runtime.stop();
        }
      },
    );
  });
});
