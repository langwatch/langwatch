/**
 * The connected-agent relay state contract, stated once and run against both
 * tiers: the memory twin, and the Redis tier over an in-memory Redis. A
 * clock the test moves stands in for every expiry.
 * @see specs/agents/connected-agents.feature
 */
import type { StoredCall } from "@langwatch/agent-contract";
import { memorySessionState } from "@langwatch/process-stores";
import { beforeEach, describe, expect, it } from "vitest";

import type {
  ConnectedAgentStateRepository,
  InstanceMeta,
  StoredSession,
} from "../connected-agent-state.repository.ts";
import { MemoryConnectedAgentStateRepository } from "../memory/memory.connected-agent-state.repository.ts";
import { RedisConnectedAgentStateRepository } from "../redis/redis.connected-agent-state.repository.ts";

const projectId = "proj_contract";
const otherProjectId = "proj_other";
const instanceId = "inst_contract";
const agentId = "agent_contract";
const callId = "call_contract";

function meta(overrides: Partial<InstanceMeta> = {}): InstanceMeta {
  return {
    instanceId,
    projectId,
    hostname: "laptop",
    username: "dev",
    pid: 7,
    sdk: { name: "langwatch", version: "1.0.0", language: "python" },
    label: "blue",
    podId: "pod_a",
    connectedAt: 1_000,
    maxConcurrency: 3,
    ...overrides,
  };
}

function call(owner = projectId): StoredCall {
  return {
    projectId: owner,
    instanceId,
    replyTo: "pod_a",
    envelope: {
      callId,
      agentId,
      threadId: "thread_1",
      messages: [{ role: "user", content: "hi" }],
      newMessages: [{ role: "user", content: "hi" }],
      params: {},
      session: null,
      traceparent: null,
      deadlineAt: 90_000,
      run: {},
    },
  };
}

function session(): StoredSession {
  return {
    principalId: "key:test",
    token: "ait_contract",
    instanceId,
    projectId,
    projectSlug: "contract",
    agentIds: [agentId],
    meta: meta(),
  };
}

type Tier = (now: () => number) => ConnectedAgentStateRepository;

const tiers: Record<string, Tier> = {
  memory: (now) => MemoryConnectedAgentStateRepository.create({ now }),
  redis: (now) => RedisConnectedAgentStateRepository.create(memorySessionState({ now })),
};

describe.each(Object.entries(tiers))("ConnectedAgentStateRepository (%s)", (_name, tier) => {
  let clock: number;
  let state: ConnectedAgentStateRepository;

  beforeEach(() => {
    clock = 10_000;
    state = tier(() => clock);
  });

  describe("given an instance record", () => {
    it("reads back as written, and is gone once its expiry passes", async () => {
      await state.saveInstance({ meta: meta(), agentIds: [agentId, "agent_b"], ttlSeconds: 30 });

      expect(await state.findInstance({ projectId, instanceId })).toEqual([
        { meta: meta(), agentIds: [agentId, "agent_b"] },
      ]);
      expect(await state.findInstance({ projectId: otherProjectId, instanceId })).toEqual([]);

      clock += 30_000;
      expect(await state.findInstance({ projectId, instanceId })).toEqual([]);
    });

    it("is extended while present, restored when gone, and left absent with nothing to restore", async () => {
      await state.saveInstance({ meta: meta(), agentIds: [agentId], ttlSeconds: 30 });
      clock += 20_000;
      await state.extendInstance({ projectId, instanceId, ttlSeconds: 30 });
      clock += 20_000;
      expect(await state.findInstance({ projectId, instanceId })).toHaveLength(1);

      clock += 30_000;
      await state.extendInstance({ projectId, instanceId, ttlSeconds: 30 });
      expect(await state.findInstance({ projectId, instanceId })).toEqual([]);

      await state.extendInstance({
        projectId,
        instanceId,
        restore: { meta: meta({ podId: "pod_b" }), agentIds: [agentId] },
        ttlSeconds: 30,
      });
      expect(await state.findInstance({ projectId, instanceId })).toEqual([
        { meta: meta({ podId: "pod_b" }), agentIds: [agentId] },
      ]);
    });

    it("is gone once deleted", async () => {
      await state.saveInstance({ meta: meta(), agentIds: [agentId], ttlSeconds: 30 });
      await state.deleteInstance({ projectId, instanceId });
      expect(await state.findInstance({ projectId, instanceId })).toEqual([]);
    });
  });

  describe("given the instances seen serving an agent", () => {
    it("prunes those seen at or before the cutoff and lists the rest, oldest first", async () => {
      const seen = (id: string, seenAt: number) =>
        state.markInstanceSeen({ projectId, agentId, instanceId: id, seenAt, ttlSeconds: 60 });
      await seen("inst_late", 300);
      await seen("inst_early", 200);
      await seen("inst_stale", 100);

      expect(await state.pruneSeenInstanceIds({ projectId, agentId, cutoff: 100 })).toEqual([
        "inst_early",
        "inst_late",
      ]);
      expect(await state.pruneSeenInstanceIds({ projectId, agentId, cutoff: 0 })).toEqual([
        "inst_early",
        "inst_late",
      ]);
    });

    it("only ever lowers a present member's time, and never adds one", async () => {
      await state.markInstanceSeen({ projectId, agentId, instanceId, seenAt: 500, ttlSeconds: 60 });
      await state.lowerInstanceSeen({ projectId, agentId, instanceId, seenAt: 900 });
      await state.lowerInstanceSeen({ projectId, agentId, instanceId: "inst_new", seenAt: 900 });
      expect(await state.pruneSeenInstanceIds({ projectId, agentId, cutoff: 400 })).toEqual([
        instanceId,
      ]);

      await state.lowerInstanceSeen({ projectId, agentId, instanceId, seenAt: 100 });
      expect(await state.pruneSeenInstanceIds({ projectId, agentId, cutoff: 400 })).toEqual([]);
    });
  });

  describe("given the in-flight count", () => {
    it("counts up and down from zero", async () => {
      const key = { projectId, instanceId };
      expect(await state.countInflight(key)).toBe(0);
      expect(await state.incrementInflight({ ...key, ttlSeconds: 60 })).toBe(1);
      expect(await state.incrementInflight({ ...key, ttlSeconds: 60 })).toBe(2);
      expect(await state.decrementInflight(key)).toBe(1);
      expect(await state.countInflight(key)).toBe(1);
    });
  });

  describe("given an ownership claim", () => {
    it("is renewed by its holder, refused to another, and free once expired", async () => {
      const claim = (principalId: string) =>
        state.claimInstanceOwner({ projectId, instanceId, principalId, ttlSeconds: 60 });
      expect(await claim("alice")).toBe(true);
      expect(await claim("alice")).toBe(true);
      expect(await claim("bob")).toBe(false);
      expect(
        await state.claimInstanceOwner({
          projectId: otherProjectId,
          instanceId,
          principalId: "bob",
          ttlSeconds: 60,
        }),
      ).toBe(true);

      clock += 60_000;
      expect(await claim("bob")).toBe(true);
    });
  });

  describe("given a call", () => {
    it("reads back under its own project only, and is gone once deleted", async () => {
      expect(await state.readCall({ projectId, callId })).toEqual({ kind: "miss" });
      await state.saveCall({ call: call(), ttlSeconds: 60 });

      expect(await state.readCall({ projectId, callId })).toEqual({ kind: "hit", value: call() });
      expect(await state.readCall({ projectId: otherProjectId, callId })).toEqual({
        kind: "miss",
      });

      await state.deleteCall({ projectId, callId });
      expect(await state.readCall({ projectId, callId })).toEqual({ kind: "miss" });
    });

    it("is handed out over HTTP once until the claim expires", async () => {
      const claim = () => state.claimCallDelivery({ projectId, callId, ttlSeconds: 60 });
      expect(await claim()).toBe(true);
      expect(await claim()).toBe(false);
      clock += 60_000;
      expect(await claim()).toBe(true);
    });

    it("is listed as pending by deadline until removed", async () => {
      const pending = (id: string, deadlineAt: number) =>
        state.addPendingCall({ projectId, instanceId, callId: id, deadlineAt, ttlSeconds: 60 });
      await pending("call_late", 300);
      await pending("call_soon", 200);
      await pending("call_past", 100);

      expect(await state.findPendingCallIds({ projectId, instanceId, from: 150 })).toEqual([
        "call_soon",
        "call_late",
      ]);
      await state.removePendingCall({ projectId, instanceId, callId: "call_soon" });
      expect(await state.findPendingCallIds({ projectId, instanceId, from: 0 })).toEqual([
        "call_past",
        "call_late",
      ]);

      clock += 60_000;
      expect(await state.findPendingCallIds({ projectId, instanceId, from: 0 })).toEqual([]);
    });
  });

  describe("given a result", () => {
    it("reads back as written, and is gone once its expiry passes", async () => {
      const result = { instanceId, output: "done" };
      expect(await state.readResult({ projectId, callId })).toEqual({ kind: "miss" });
      await state.saveResult({ projectId, callId, result, ttlSeconds: 60 });
      expect(await state.readResult({ projectId, callId })).toEqual({ kind: "hit", value: result });

      clock += 60_000;
      expect(await state.readResult({ projectId, callId })).toEqual({ kind: "miss" });
    });
  });

  describe("given an HTTP session", () => {
    it("reads back under its token and project, and is gone once deleted", async () => {
      await state.saveHttpSession({ session: session(), ttlSeconds: 60 });
      const key = { projectId, token: "ait_contract" };

      expect(await state.readHttpSession(key)).toEqual({ kind: "hit", value: session() });
      expect(await state.readHttpSession({ ...key, projectId: otherProjectId })).toEqual({
        kind: "miss",
      });

      await state.deleteHttpSession(key);
      expect(await state.readHttpSession(key)).toEqual({ kind: "miss" });
    });
  });

  describe("given a sticky thread pin", () => {
    it("names the pinned instance until its expiry passes", async () => {
      const thread = { projectId, agentId, threadId: "thread_1" };
      expect(await state.readThreadPin(thread)).toEqual({ kind: "unpinned" });
      await state.pinThread({ ...thread, instanceId, ttlSeconds: 60 });
      expect(await state.readThreadPin(thread)).toEqual({ kind: "pinned", instanceId });

      clock += 60_000;
      expect(await state.readThreadPin(thread)).toEqual({ kind: "unpinned" });
    });
  });
});
