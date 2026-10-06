import type { AgentApi } from "@langwatch/agent-contract";
import type { AnnotationApi } from "@langwatch/annotation-contract";
import { AuditLogApi } from "@langwatch/audit-log-contract";
import type { DatasetApi } from "@langwatch/dataset-contract";
import type { MonitorApi } from "@langwatch/monitor-contract";
import { createApp } from "@langwatch/process";
import { memoryStores } from "@langwatch/process-stores";
import type { ProjectApi } from "@langwatch/project-contract";
import type { PromptApi } from "@langwatch/prompt-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { WorkflowApi } from "@langwatch/workflow-contract";
import { describe, expect, it } from "vitest";

import { auditLogProcessModule } from "../../audit-log.module.ts";

function process(role: "api" | "worker") {
  return createApp({ role })
    .withModules([auditLogProcessModule])
    .withStores(memoryStores())
    .withConfig({ "audit-log": { maxArgsBytes: 4 * 1024 } })
    .provide({
      project: createApiFixture<ProjectApi>({}),
      prompt: createApiFixture<PromptApi>({}),
      workflow: createApiFixture<WorkflowApi>({}),
      dataset: createApiFixture<DatasetApi>({}),
      monitor: createApiFixture<MonitorApi>({}),
      annotation: createApiFixture<AnnotationApi>({}),
      agent: createApiFixture<AgentApi>({}),
    });
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
      const runtime = await process(role).boot();

      try {
        const app = runtime.service(AuditLogApi);
        expect(runtime.module(auditLogProcessModule).provided).toBe(app);

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
      const runtime = await process("api").boot();

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
