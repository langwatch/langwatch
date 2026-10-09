import type { AuthzApi } from "@langwatch/authz-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { createAgentAppFixture, secretStoreFixture } from "./agent.fixture.ts";

const projectId = "project_1";
const config = {
  url: "https://agent.test/chat",
  method: "POST" as const,
  headers: [
    { key: "X-Tenant-Key", value: "tenant-secret" },
    { key: "Accept", value: "application/json" },
  ],
  auth: { type: "bearer" as const, token: "token-secret" },
};

async function savedHttpAgent(options: Parameters<typeof createAgentAppFixture>[0] = {}) {
  const store = secretStoreFixture();
  const fixture = createAgentAppFixture({ secrets: store.secrets, ...options });
  const agent = await fixture.app.create({ projectId, name: "http", type: "http", config });

  return { ...fixture, agent, values: store.values };
}

describe("AgentModule HTTP agent credentials", () => {
  /** @scenario "Saving an HTTP agent with blank credentials keeps the stored ones" */
  it("keeps the stored header and bearer token where the update leaves them blank", async () => {
    const { app, agent } = await savedHttpAgent();
    const before = await app.getById({ id: agent.id, projectId });

    await app.update({
      id: agent.id,
      projectId,
      config: {
        ...config,
        url: "https://agent.test/v2",
        headers: [
          { key: "X-Tenant-Key", value: "" },
          { key: "Accept", value: "application/json" },
        ],
        auth: { type: "bearer", token: "" },
      },
    });

    const stored = await app.getById({ id: agent.id, projectId });
    expect(stored.config).toMatchObject({
      url: "https://agent.test/v2",
      headers: before.type === "http" ? before.config.headers : [],
      auth: before.type === "http" ? before.config.auth : {},
    });
  });

  /** @scenario "Saving an HTTP agent with a new credential replaces the stored one" */
  it("replaces the stored token when the update carries a new one", async () => {
    const { app, agent, values } = await savedHttpAgent();

    await app.update({
      id: agent.id,
      projectId,
      config: { ...config, auth: { type: "bearer", token: "fresh-token" } },
    });

    const stored = await app.getById({ id: agent.id, projectId });
    expect(JSON.stringify(stored)).not.toContain("fresh-token");
    expect(Object.values(values)).toContain("fresh-token");
  });

  /** @scenario An HTTP agent's secrets are named from its id */
  it("names the secrets after the agent's id, not its name", async () => {
    const { agent, values } = await savedHttpAgent();
    const prefix = `HTTP_${agent.id.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_`;

    expect(Object.keys(values).toSorted()).toEqual([
      `${prefix}AUTH_TOKEN`,
      `${prefix}HEADER_X_TENANT_KEY`,
    ]);
  });

  describe("given an update that moves the agent to another address", () => {
    /** @scenario An update that moves an agent to another address needs its credentials again */
    it("refuses it while a credential is left blank, and keeps the agent as it was", async () => {
      const { app, agent } = await savedHttpAgent();
      const before = await app.getById({ id: agent.id, projectId });

      await expect(
        app.update({
          id: agent.id,
          projectId,
          config: {
            ...config,
            url: "https://elsewhere.test/chat",
            auth: { type: "bearer", token: "" },
          },
        }),
      ).rejects.toMatchObject({
        code: "agent_stored_credentials_destination_mismatch",
        httpStatus: 422,
      });
      expect(await app.getById({ id: agent.id, projectId })).toEqual(before);
    });

    /** @scenario An update that moves an agent to another address needs its credentials again */
    it("accepts it once every credential is entered again", async () => {
      const { app, agent } = await savedHttpAgent();

      await app.update({
        id: agent.id,
        projectId,
        config: {
          ...config,
          url: "https://elsewhere.test/chat",
          headers: [{ key: "X-Tenant-Key", value: "tenant-new" }],
          auth: { type: "bearer", token: "token-new" },
        },
      });

      expect((await app.getById({ id: agent.id, projectId })).config).toMatchObject({
        url: "https://elsewhere.test/chat",
      });
    });
  });

  describe("given a copy into another project", () => {
    /** @scenario A copy into another project arrives with blank credentials */
    it("arrives with every credential blank, references too, and the rest as it was", async () => {
      const { app, agent, repositories } = await savedHttpAgent({
        permissions: createApiFixture<AuthzApi>({ hasProjectPermission: async () => true }),
      });

      await app.createCopy({
        sourceAgentId: agent.id,
        sourceProjectId: projectId,
        targetProjectId: "project_2",
      });

      const [copy] = await repositories.agents.findAll({ projectId: "project_2" });
      expect(copy?.config).toMatchObject({
        url: config.url,
        headers: [
          { key: "X-Tenant-Key", value: "" },
          { key: "Accept", value: "application/json" },
        ],
        auth: { type: "bearer", token: "" },
      });
    });
  });
});
