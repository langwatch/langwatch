import { describe, expect, it, onTestFinished } from "vitest";
import { PROTOCOL_VERSION } from "@langwatch/agent-contract";
import type { ApiKeyApi } from "@langwatch/api-key-contract";
import type { UserApi } from "@langwatch/user-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { createAgentAppFixture } from "../../testing.ts";

const projectId = "project_1";
const connected = {
  id: "agent_1",
  projectId,
  name: "support-agent",
  config: {
    sdk: { name: "langwatch", version: "1.0.0", language: "python" },
    parameters: [{ name: "model", defaultValue: "gpt-5-mini" }],
  },
  identity: {
    environment: "production",
    ownerUserId: null,
    hostLabel: null,
    identityKey: "support-agent@production",
  },
};

describe("AgentApp connected views", () => {
  it("reports the parameters and live instance registered through its connected runtime", async () => {
    const { app, resources } = createAgentAppFixture({
      config: {
        publicBaseUrl: "https://langwatch.test",
        connected: { replicaCount: 1, relayMaxPayloadMb: void 0 },
      },
      apiKeys: createApiFixture<ApiKeyApi>({
        findResolvedToken: async () => ({
          type: "legacyProjectKey",
          project: {
            id: projectId,
            name: "Project",
            slug: "project",
            teamId: "team_1",
            organizationId: "org_1",
            isPersonal: false,
            ownerUserId: null,
          },
        }),
      }),
    });
    const services = resources.sealServices();
    onTestFinished(async () => {
      for (const service of services) await service.stop();
      await resources.close();
    });
    for (const service of services) await service.start();

    const registered = await app.connectRegister(
      {
        type: "register",
        protocol: PROTOCOL_VERSION,
        sdk: connected.config.sdk,
        instance: {
          id: "instance_1",
          hostname: "host",
          username: "user",
          pid: 1,
          startedAt: new Date().toISOString(),
          inFlightCallIds: [],
        },
        agents: [
          {
            name: connected.name,
            environment: "production",
            parameters: {
              type: "object",
              properties: { model: { type: "string", default: "gpt-5-mini" } },
            },
          },
        ],
      },
      { authorization: "Bearer sk-lw-test", projectId },
    );
    expect(registered.frame.type).toBe("registered");

    const agents = await app.getAll({ projectId });

    expect(agents).toHaveLength(1);
    expect(agents[0]?.parameters).toEqual([
      { name: "model", type: "string", defaultValue: "gpt-5-mini" },
    ]);
    expect(agents[0]?.owner).toBeNull();
    expect(agents[0]?.status).toBe("online");
    expect(agents[0]?.instances).toMatchObject([{ instanceId: "instance_1", hostname: "host" }]);
  });

  it("reports offline and no instances when no connected runtime is composed", async () => {
    const { app } = createAgentAppFixture();
    await app.registerConnected(connected);

    expect(await app.getById({ id: connected.id, projectId })).toMatchObject({
      status: "offline",
      instances: [],
      parameters: connected.config.parameters,
    });
  });

  it("lists personal and hosted rows while preventing a project key selecting a personal row", async () => {
    const { app } = createAgentAppFixture({
      users: createApiFixture<UserApi>({ getProfiles: async () => [] }),
    });
    await app.registerConnected({
      ...connected,
      id: "agent_personal",
      identity: {
        ...connected.identity,
        environment: "development",
        ownerUserId: "user_1",
        identityKey: "personal",
      },
    });
    await app.registerConnected({
      ...connected,
      id: "agent_hosted",
      identity: {
        ...connected.identity,
        environment: "development",
        hostLabel: "acme-laptop",
        identityKey: "hosted",
      },
    });

    const rows = await app.getAll({ projectId, viewerUserId: null });

    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.id === "agent_personal")).toMatchObject({
      selectable: false,
      owner: { userId: "user_1", name: null },
    });
    expect(rows.find((row) => row.id === "agent_hosted")?.selectable).toBe(true);
  });
});
