/**
 * @vitest-environment node
 * @see modules/scenario/specs/http-agent-test.feature
 */
import { agentOverviewSchema, type AgentApi } from "@langwatch/agent-contract";
import type { SecretApi } from "@langwatch/secret-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { TraceApi } from "@langwatch/trace-contract";
import type { WorkflowApi } from "@langwatch/workflow-contract";
import { describe, expect, it } from "vitest";

import { HttpAgentTestService } from "../http-agent-test.service.ts";

const projectId = "project_1";
const savedUrl = "https://agent.test/chat";

const storedAgent = agentOverviewSchema.parse({
  id: "agent_http",
  projectId,
  name: "http",
  type: "http",
  config: {
    url: savedUrl,
    method: "POST",
    headers: [
      { key: "X-Tenant-Key", value: "{{ secrets.HTTP_TENANT_KEY }}" },
      { key: "Accept", value: "application/json" },
    ],
    auth: { type: "bearer", token: "{{ secrets.HTTP_TOKEN }}" },
  },
  workflowId: null,
  copiedFromAgentId: null,
  archivedAt: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  inputFields: [],
  outputFields: [],
  fieldsResolved: true,
  environment: null,
  ownerUserId: null,
  hostLabel: null,
  lastSeenAt: null,
  parameters: [],
  owner: null,
  status: "offline",
  instances: [],
  selectable: true,
  notSelectableReason: null,
});

const blank = {
  projectId,
  actorId: "user_1",
  method: "POST" as const,
  headers: [{ key: "X-Tenant-Key", value: "" }],
  auth: { type: "bearer" as const, token: "" },
  bodyTemplate: "{}",
};

function testingSavedAgent() {
  const sent: string[] = [];
  const spans: string[] = [];
  const values: Record<string, string> = {
    HTTP_TENANT_KEY: "tenant-secret",
    HTTP_TOKEN: "token-secret",
  };
  const service = HttpAgentTestService.create({
    agents: createApiFixture<AgentApi>({ getById: async () => storedAgent }),
    secrets: createApiFixture<SecretApi>({
      getValuesByName: async ({ names }) =>
        Object.fromEntries(Object.entries(values).filter(([name]) => names.includes(name))),
    }),
    workflows: createApiFixture<WorkflowApi>({
      executeComponent: async (input) => {
        sent.push(JSON.stringify(input.workflow));
        return { status: "success", outputs: { output: "pong" } };
      },
    }),
    traces: createApiFixture<TraceApi>({
      recordCapturedSpan: async (input) => {
        spans.push(JSON.stringify(input));
      },
    }),
  });

  return { service, sent, spans, values, agent: storedAgent };
}

describe("HttpAgentTestService", () => {
  /** @scenario "Sending a test request from the agent editor executes it" */
  it("runs the request through the workflow engine and answers its output", async () => {
    const executed: string[] = [];
    const service = HttpAgentTestService.create({
      agents: createApiFixture<AgentApi>(),
      secrets: createApiFixture<SecretApi>(),
      traces: createApiFixture<TraceApi>(),
      workflows: createApiFixture<WorkflowApi>({
        executeComponent: async (input) => {
          executed.push(input.origin);
          return { status: "success", outputs: { output: "pong" } };
        },
      }),
    });

    const result = await service.execute({
      projectId,
      actorId: "user_1",
      url: savedUrl,
      method: "POST",
      bodyTemplate: '{"input": "ping"}',
    });

    expect(executed).toEqual(["agent_test"]);
    expect(result).toMatchObject({ success: true, extractedOutput: "pong" });
  });

  describe("given a test call that would use stored credentials", () => {
    /** @scenario "Testing a saved HTTP agent uses its stored credentials for blank ones" */
    it("fills the stored references and sends the project's secrets to resolve them", async () => {
      const { service, agent, sent } = testingSavedAgent();

      await service.execute({ ...blank, agentId: agent.id, url: savedUrl });

      expect(sent[0]).toContain("{{ secrets.HTTP_");
      expect(sent[0]).toContain("token-secret");
      expect(sent[0]).toContain("tenant-secret");
    });

    /** @scenario A test call resolves only the secrets the saved agent references */
    it("sends only the secrets the saved config references, never the rest of the project", async () => {
      const { service, agent, sent, values } = testingSavedAgent();
      values.UNSAVED = "unsaved-secret";

      await service.execute({
        ...blank,
        agentId: agent.id,
        url: savedUrl,
        headers: [{ key: "X-Extra", value: "{{ secrets.UNSAVED }}" }],
      });

      expect(sent[0]).toContain("token-secret");
      expect(sent[0]).not.toContain("unsaved-secret");
    });

    /** @scenario A test call never traces a stored credential */
    it("traces the headers as typed, never the stored values", async () => {
      const { service, agent, spans } = testingSavedAgent();

      await service.execute({ ...blank, agentId: agent.id, url: savedUrl });

      expect(spans).toHaveLength(1);
      expect(spans[0]).not.toContain("token-secret");
      expect(spans[0]).not.toContain("tenant-secret");
      expect(spans[0]).not.toContain("{{ secrets.");
    });

    /** @scenario "A test call to a different address than the saved agent's is refused when it would use stored credentials" */
    it("refuses a different address and sends nothing", async () => {
      const { service, agent, sent } = testingSavedAgent();

      await expect(
        service.execute({ ...blank, agentId: agent.id, url: "https://elsewhere.test/chat" }),
      ).rejects.toMatchObject({
        code: "agent_stored_credentials_destination_mismatch",
        httpStatus: 422,
      });
      expect(sent).toEqual([]);
    });

    /** @scenario "A test call whose address resolves to another host through a secret is refused" */
    it("checks the address after its references are resolved", async () => {
      const { service, agent, sent, values } = testingSavedAgent();
      values.HOST = "elsewhere.test/x#";

      await expect(
        service.execute({
          ...blank,
          agentId: agent.id,
          url: "https://{{ secrets.HOST }}@agent.test/chat",
        }),
      ).rejects.toMatchObject({ code: "agent_stored_credentials_destination_mismatch" });
      expect(sent).toEqual([]);
    });

    /** @scenario "A test call to the saved address uses the stored credentials" */
    it("fills the stored credentials at the saved address, however it is spelled", async () => {
      const { service, agent, sent } = testingSavedAgent();

      await service.execute({
        ...blank,
        agentId: agent.id,
        url: "https://AGENT.test:443/other-path",
      });

      expect(sent[0]).toContain("token-secret");
      expect(sent[0]).toContain("tenant-secret");
    });

    /** @scenario "A test call with no saved agent fills nothing, and typed credentials are used as typed" */
    it("sends the typed credentials as typed to any address, and fills none without an agent", async () => {
      const { service, agent, sent } = testingSavedAgent();

      await service.execute({
        ...blank,
        agentId: agent.id,
        url: "https://elsewhere.test/chat",
        headers: [{ key: "X-Tenant-Key", value: "typed-tenant" }],
        auth: { type: "bearer", token: "typed-token" },
      });
      await service.execute({ ...blank, url: savedUrl });

      expect(sent[0]).toContain("typed-token");
      expect(sent[0]).not.toContain("token-secret");
      expect(sent[1]).not.toContain("token-secret");
      expect(sent[1]).not.toContain("tenant-secret");
    });
  });
});
