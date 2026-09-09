/**
 * The agent module, served by the API process.
 *
 * Booted over the memory repositories rather than a Prisma double: the point of
 * the installer is that persistence is chosen once, at boot, so the same graph
 * this test drives is the one `installApiAgent`
 * (`apps/api/src/app/api-agents.composition.ts`) builds over Postgres.
 */
import { TraceApi } from "@langwatch/trace-contract";
import { AgentApi } from "@langwatch/agent-contract";
import { agentServer } from "@langwatch/agent-server";
import { ApiKeyApi } from "@langwatch/api-key-contract";
import { AuditLogApi } from "@langwatch/audit-log-contract";
import { AuthzApi } from "@langwatch/authz-contract";
import { ProjectApi } from "@langwatch/project-contract";
import { createApp } from "@langwatch/runtime-composition";
import { ScenarioApi } from "@langwatch/scenario-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { UserApi } from "@langwatch/user-contract";
import { WorkflowApi } from "@langwatch/workflow-contract";
import { describe, expect, it } from "vitest";

const PROJECT_ID = "project-1";

async function bootAgent() {
  const runtime = await createApp({ name: "langwatch-api" })
    .withPersistence("memory", {})
    .withInfrastructure({ redis: null })
    .withProvided(ApiKeyApi, createApiFixture<ApiKeyApi>())
    .withProvided(AuditLogApi, createApiFixture<AuditLogApi>())
    .withProvided(AuthzApi, createApiFixture<AuthzApi>())
    .withProvided(ProjectApi, createApiFixture<ProjectApi>())
    .withProvided(ScenarioApi, createApiFixture<ScenarioApi>())
    .withProvided(TraceApi, createApiFixture<TraceApi>())
    .withProvided(UserApi, createApiFixture<UserApi>())
    .withProvided(WorkflowApi, createApiFixture<WorkflowApi>())
    .withModule(agentServer)
    .boot({
      role: "api",
      config: { agent: { publicBaseUrl: "https://app.example.test", connected: null } },
    });

  return runtime.service(AgentApi);
}

describe("given the API process installs the agent module", () => {
  describe("when a project creates a signature agent", () => {
    it("reads back the agent it created", async () => {
      const agents = await bootAgent();

      const created = await agents.create({
        projectId: PROJECT_ID,
        name: "Test agent",
        type: "signature",
        config: { prompt: "Help the user" },
      });

      const found = await agents.getById({ id: created.id, projectId: PROJECT_ID });

      expect(found.name).toBe("Test agent");
      expect(found.type).toBe("signature");
    });

    it("builds the agent's own platform URL from the configured public base", async () => {
      const agents = await bootAgent();

      const url = agents.platformUrl({
        projectSlug: "acme",
        agentId: "agent_1",
        agentType: "signature",
      });

      expect(url).toBe(
        "https://app.example.test/acme/agents?drawer.open=agentCodeEditor&drawer.agentId=agent_1",
      );
    });
  });
});
