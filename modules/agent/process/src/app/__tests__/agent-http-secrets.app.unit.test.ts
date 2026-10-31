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

    describe("when the source's hooks URL is set and the copy holds credentials of its own", () => {
      const hooks = { setup: true, teardown: true };
      const blankCredentials = {
        headers: [
          { key: "X-Tenant-Key", value: "" },
          { key: "Accept", value: "application/json" },
        ],
        auth: { type: "bearer" as const, token: "" },
      };

      /** A copy in project_2 that typed its own credentials and rotated its signing secret once. */
      async function copyHoldingCredentials(sourceHooksUrl: string) {
        const fixture = await savedHttpAgent({
          permissions: createApiFixture<AuthzApi>({ hasProjectPermission: async () => true }),
        });
        const { app, agent } = fixture;
        const { id } = await app.createCopy({
          sourceAgentId: agent.id,
          sourceProjectId: projectId,
          targetProjectId: "project_2",
        });
        const copyConfig = {
          ...config,
          headers: [
            { key: "X-Tenant-Key", value: "copy-tenant" },
            { key: "Accept", value: "application/json" },
          ],
          auth: { type: "bearer" as const, token: "copy-token" },
          hooksUrl: "https://agent.test/hooks",
          hooks,
          hooksSigningSecret: "whsec_copy_0123456789abcdef",
        };
        await app.update({ id, projectId: "project_2", config: copyConfig });
        await app.update({
          id,
          projectId: "project_2",
          config: {
            ...copyConfig,
            ...blankCredentials,
            hooksSigningSecret: "whsec_copy_rotated_0123456789",
          },
        });
        await app.update({
          id: agent.id,
          projectId,
          config: {
            ...config,
            hooksUrl: sourceHooksUrl,
            hooks,
            hooksSigningSecret: "whsec_source_0123456789abcdef",
          },
        });

        return { ...fixture, copyId: id };
      }

      const expectNoStoredCredential = (copy: { config: unknown }) => {
        expect(copy.config).toMatchObject({
          hooksUrl: "https://evil.test/hooks",
          ...blankCredentials,
          hooksSigningSecret: "",
        });
        expect(copy.config).not.toHaveProperty("hooksPreviousSigningSecret");
        expect(JSON.stringify(copy.config)).not.toContain("secrets.");
      };

      /** @scenario A copy updated from its source takes no stored credential to a hooks URL on another origin */
      it("a push to a hooks URL on another origin carries none of the copy's credentials", async () => {
        const { app, agent, copyId } = await copyHoldingCredentials("https://evil.test/hooks");

        await app.pushToCopies({ sourceAgentId: agent.id, sourceProjectId: projectId });

        expectNoStoredCredential(await app.getById({ id: copyId, projectId: "project_2" }));
      });

      /** @scenario A copy updated from its source takes no stored credential to a hooks URL on another origin */
      it("a sync to a hooks URL on another origin carries none of the copy's credentials", async () => {
        const { app, copyId } = await copyHoldingCredentials("https://evil.test/hooks");

        await app.syncFromSource({ agentId: copyId, projectId: "project_2" });

        expectNoStoredCredential(await app.getById({ id: copyId, projectId: "project_2" }));
      });

      it("a push on the copy's hooks origin keeps the copy's credentials and window", async () => {
        const { app, agent, copyId } = await copyHoldingCredentials("https://agent.test/v2/hooks");
        const before = await app.getById({ id: copyId, projectId: "project_2" });

        await app.pushToCopies({ sourceAgentId: agent.id, sourceProjectId: projectId });

        const after = await app.getById({ id: copyId, projectId: "project_2" });
        expect(before.type === "http" && before.config.hooksPreviousSigningSecret).toBeTruthy();
        expect(after.config).toMatchObject({
          hooksUrl: "https://agent.test/v2/hooks",
          headers: before.type === "http" ? before.config.headers : [],
          auth: before.type === "http" ? before.config.auth : {},
          hooksSigningSecret: before.type === "http" ? before.config.hooksSigningSecret : "",
          hooksPreviousSigningSecret:
            before.type === "http" ? before.config.hooksPreviousSigningSecret : {},
        });
      });
    });
  });

  it("leaves no new project secret behind when a rotation moves the hooks host and is refused", async () => {
    const { app, agent, values } = await savedHttpAgent();
    const before = { ...values };

    await expect(
      app.update({
        id: agent.id,
        projectId,
        config: {
          ...config,
          hooksUrl: "https://elsewhere.test/hooks",
          hooks: { setup: true, teardown: true },
          headers: [
            { key: "X-Tenant-Key", value: "" },
            { key: "Accept", value: "application/json" },
          ],
          auth: { type: "bearer", token: "" },
          hooksSigningSecret: "whsec_brand_new_0123456789",
        },
      }),
    ).rejects.toMatchObject({ code: "agent_stored_credentials_destination_mismatch" });

    expect(values).toEqual(before);
  });
});
