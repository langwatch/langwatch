import { PROTOCOL_VERSION, type RegisterFrame } from "@langwatch/agent-contract";
import { SessionStateStoreFactory, type SessionStateStore } from "@langwatch/redis-client";
import { describe, expect, it } from "vitest";
import { MemoryAgentRepository } from "../../repositories/memory/memory.agent.repository.ts";
import { AgentService } from "../agent.service.ts";
import { ConnectedAgentRuntimeService } from "../connected-agent-runtime.service.ts";
import { ConnectedAgentRegistrationService } from "../connected-agent-registration.service.ts";
import { AgentSessionService } from "../connected-agent-session.service.ts";
import { LongPollTransportService } from "../connected-agent-long-poll.service.ts";

const frame: RegisterFrame = {
  type: "register",
  protocol: PROTOCOL_VERSION,
  sdk: { name: "langwatch", version: "1", language: "python" },
  instance: {
    id: "instance",
    hostname: "laptop",
    username: "dev",
    pid: 1,
    startedAt: "2026-09-08T00:00:00Z",
    inFlightCallIds: [],
  },
  agents: [{ name: "personal", environment: "development", parameters: {} }],
};

function resolved(principalId: string, projectId = "project") {
  return { principalId, userId: principalId, project: { id: projectId, slug: projectId } };
}

function fixture(store: SessionStateStore = SessionStateStoreFactory.memory()) {
  const agents = AgentService.create(MemoryAgentRepository.create());
  const runtime = ConnectedAgentRuntimeService.create({ store, podId: "pod-a" });
  const otherRuntime = ConnectedAgentRuntimeService.create({ store, podId: "pod-b" });
  const registration = (peer: typeof runtime) =>
    ConnectedAgentRegistrationService.create({
      runtime: peer,
      agents,
      publicBaseUrl: "https://example.test",
      now: () => Date.now(),
    });
  return {
    store,
    agents,
    runtime,
    first: registration(runtime),
    second: registration(otherRuntime),
  };
}

describe("connected instance ownership", () => {
  /** @scenario "Competing principals cannot register the same project instance" */
  it("atomically accepts one principal across replicas before writing agent rows", async () => {
    const { first, second, agents, runtime } = fixture();
    const results = await Promise.allSettled([
      first.registerInstance({ frame, resolved: resolved("alice"), heartbeatIntervalMs: 1000 }),
      second.registerInstance({ frame, resolved: resolved("bob"), heartbeatIntervalMs: 1000 }),
    ]);
    const accepted = results.filter((result) => result.status === "fulfilled");
    const refused = results.filter((result) => result.status === "rejected");
    expect(accepted).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect(refused[0]?.reason).toMatchObject({ meta: { reason: "permission_denied" } });
    const rows = await agents.getAll({ projectId: "project" });
    expect(rows).toHaveLength(1);
    const winner = accepted[0];
    if (!winner) throw new Error("Registration must have a winner");
    expect(rows[0]?.ownerUserId).toBe(winner.value.session.principalId);
    expect(
      await runtime.registry.listLive({ projectId: "project", agentId: rows[0]!.id }),
    ).toMatchObject([{ podId: winner.value.session.meta.podId }]);
  });

  /** @scenario "The owning principal can reconnect an instance" */
  it("preserves the agent identity when the principal reconnects on another replica", async () => {
    const { first, second } = fixture();
    const input = { frame, resolved: resolved("alice"), heartbeatIntervalMs: 1000 };
    const original = await first.registerInstance(input);
    const reconnected = await second.registerInstance(input);
    expect(reconnected.registered.agents).toEqual(original.registered.agents);
    expect(reconnected.session.meta.podId).toBe("pod-b");
  });

  /** @scenario "Instance ownership is independent across projects" */
  it("allows the same instance ID under another project", async () => {
    const { first, second, agents } = fixture();
    await first.registerInstance({ frame, resolved: resolved("alice"), heartbeatIntervalMs: 1000 });
    await second.registerInstance({
      frame,
      resolved: resolved("bob", "other"),
      heartbeatIntervalMs: 1000,
    });
    expect(await agents.getAll({ projectId: "project" })).toMatchObject([{ ownerUserId: "alice" }]);
    expect(await agents.getAll({ projectId: "other" })).toMatchObject([{ ownerUserId: "bob" }]);
  });

  /** @scenario "An expired session cannot overwrite a new instance owner" */
  it("rejects stale presence and retirement after another principal acquires an expired claim", async () => {
    let now = Date.now();
    const store = SessionStateStoreFactory.memory({ now: () => now });
    const { first, second, agents, runtime } = fixture(store);
    const original = await first.registerInstance({
      frame,
      resolved: resolved("alice"),
      heartbeatIntervalMs: 1000,
    });
    now += 700_000;
    const replacement = await second.registerInstance({
      frame,
      resolved: resolved("bob"),
      heartbeatIntervalMs: 1000,
    });
    const session = AgentSessionService.create({
      runtime,
      agents,
      publicBaseUrl: "https://example.test",
      replicaCount: 1,
      credentials: { resolve: async () => resolved("alice") },
    });

    await expect(session.refreshPresence(original.session)).rejects.toMatchObject({
      meta: { reason: "permission_denied" },
    });
    await expect(session.retire(original.session, [])).rejects.toMatchObject({
      meta: { reason: "permission_denied" },
    });
    const replacementId = replacement.registered.agents[0]!.id;
    expect(
      await runtime.registry.listLive({ projectId: "project", agentId: replacementId }),
    ).toMatchObject([{ podId: "pod-b" }]);
  });

  /** @scenario "An HTTP instance token cannot be reused by another principal" */
  it("refuses another principal's poll while allowing the owner to resume", async () => {
    const { store, agents, runtime } = fixture();
    const session = AgentSessionService.create({
      runtime,
      agents,
      publicBaseUrl: "https://example.test",
      replicaCount: 1,
      credentials: { resolve: async ({ token }) => resolved(token) },
    });
    const polling = LongPollTransportService.create({ session, pollWaitMs: 1 });
    try {
      const owner = { authorization: "Bearer alice", projectId: "project" };
      const registration = await polling.register({ body: frame, credentials: owner });
      expect(registration.frame.type).toBe("registered");
      await expect(
        polling.poll({
          credentials: { authorization: "Bearer bob", projectId: "project" },
          token: registration.instanceToken,
          inFlightCallIds: [],
        }),
      ).rejects.toMatchObject({ code: "agent_session_unknown" });
      expect(
        await polling.poll({
          credentials: owner,
          token: registration.instanceToken,
          inFlightCallIds: [],
        }),
      ).toEqual({ frames: [] });
      expect(await agents.getAll({ projectId: "project" })).toMatchObject([
        { ownerUserId: "alice" },
      ]);
    } finally {
      await polling.close();
      await store.close();
    }
  });
});
