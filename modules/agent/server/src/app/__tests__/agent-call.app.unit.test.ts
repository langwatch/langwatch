import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentNotFoundError, AgentOwnerOnlyError } from "@langwatch/agent-contract";
import type { UserApi } from "@langwatch/user-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { createAgentAppFixture } from "./agent.fixture.ts";
import { ConnectedAgentService } from "../../services/connected-agent.service.ts";

const register = {
  id: "agent_one",
  projectId: "project_one",
  name: "Personal agent",
  config: { sdk: { name: "langwatch", version: "1", language: "typescript" }, parameters: [] },
  identity: {
    environment: "development",
    identityKey: "personal@development/user:owner",
    ownerUserId: "owner",
    hostLabel: null,
  },
};
const input = {
  id: register.id,
  projectId: register.projectId,
  messages: [{ role: "user" as const, content: "Hello" }],
};

afterEach(() => vi.restoreAllMocks());

describe("AgentApp.call", () => {
  it.each([null, "another_user"])(
    "refuses a personal agent for viewer %s before dispatch",
    async (viewerUserId) => {
      const dispatch = vi.spyOn(ConnectedAgentService.prototype, "dispatch");
      const { app } = createAgentAppFixture({
        users: createApiFixture<UserApi>({ getProfiles: async () => [] }),
      });
      await app.registerConnected(register);

      await expect(app.call(input, { viewerUserId, traceparent: null })).rejects.toBeInstanceOf(
        AgentOwnerOnlyError,
      );
      expect(dispatch).not.toHaveBeenCalled();
    },
  );

  it("does not read an agent from another project", async () => {
    const dispatch = vi.spyOn(ConnectedAgentService.prototype, "dispatch");
    const { app } = createAgentAppFixture();
    await app.registerConnected(register);

    await expect(
      app.call(
        { ...input, projectId: "project_other" },
        { viewerUserId: "owner", traceparent: null },
      ),
    ).rejects.toBeInstanceOf(AgentNotFoundError);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("passes the owner's turn defaults to dispatch and returns only the public response", async () => {
    const dispatch = vi.spyOn(ConnectedAgentService.prototype, "dispatch").mockResolvedValue({
      output: "Hi",
      session: { cursor: "next" },
      durationMs: 12,
      instance: { instanceId: "private_instance", hostname: "laptop", label: null },
    });
    const { app, resources } = createAgentAppFixture({
      config: {
        publicBaseUrl: "https://langwatch.test",
        connected: { replicaCount: 1, relayMaxPayloadMb: void 0 },
      },
    });
    await app.registerConnected(register);
    const signal = new AbortController().signal;

    const response = await app.call(input, {
      viewerUserId: "owner",
      traceparent: "parent",
      signal,
    });

    expect(dispatch).toHaveBeenCalledWith({
      projectId: register.projectId,
      agent: {
        id: register.id,
        name: register.name,
        environment: "development",
        timeoutMs: 120_000,
        isSticky: false,
      },
      call: {
        threadId: expect.any(String),
        messages: input.messages,
        newMessages: input.messages,
        params: {},
        session: void 0,
        traceparent: "parent",
        run: {},
      },
      signal,
    });
    expect(response).toEqual({
      output: "Hi",
      session: { cursor: "next" },
      durationMs: 12,
      instance: { hostname: "laptop", label: null },
    });
    await resources.close();
  });
});
