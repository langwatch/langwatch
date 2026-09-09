import type { TraceApi } from "@langwatch/trace-contract";
import { AgentApi } from "@langwatch/agent-contract";
import type { ApiKeyApi } from "@langwatch/api-key-contract";
import type { AuditLogApi } from "@langwatch/audit-log-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import { PrismaConnectionService } from "@langwatch/prisma-client";
import type { ProjectApi } from "@langwatch/project-contract";
import type { ScenarioApi } from "@langwatch/scenario-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { UserApi } from "@langwatch/user-contract";
import type { WorkflowApi } from "@langwatch/workflow-contract";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { installApiAgent } from "../api-agents.composition.ts";

function peersFixture() {
  return {
    apiKeys: createApiFixture<ApiKeyApi>(),
    auditLog: createApiFixture<AuditLogApi>(),
    permissions: createApiFixture<AuthzApi>(),
    projects: createApiFixture<ProjectApi>(),
    scenarios: createApiFixture<ScenarioApi>(),
    traces: createApiFixture<TraceApi>(),
    users: createApiFixture<UserApi>(),
    workflows: createApiFixture<WorkflowApi>(),
  };
}

describe("installApiAgent", () => {
  it("boots one AgentApi application from the API process's required peers", async () => {
    const execute = vi.fn(async () => {
      throw new Error("Agent installation must not query at boot.");
    });
    const database = PrismaConnectionService.create({ guard: { execute } }).connect({
      databaseUrl: "postgresql://unused:unused@127.0.0.1:9/unused",
      log: [],
    });
    onTestFinished(() => database.closeOnce());

    const composition = await installApiAgent({
      database,
      infrastructure: { redis: null },
      config: { publicBaseUrl: "https://langwatch.test", connected: null },
      peers: peersFixture(),
    });

    expect(composition.agents).toBe(composition.runtime.service(AgentApi));
    expect(execute).not.toHaveBeenCalled();
    await composition.runtime.stop();
  });
});
