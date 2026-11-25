/**
 * The local-control state contract, stated once and run against both tiers:
 * the memory twin, and the Redis tier over an in-memory Redis. A clock the
 * test moves stands in for every expiry.
 * @see specs/langy/langy-local-control.feature
 */
import { memorySessionState } from "@langwatch/process-stores";
import { beforeEach, describe, expect, it } from "vitest";

import type { StoredLocalCall } from "../../rules/langy-local-call-record.rules.ts";
import type { StoredUserWait } from "../../rules/langy-local-user-wait-record.rules.ts";
import type { LangyLocalCallRepository } from "../langy-local-call.repository.ts";
import type {
  LangyLocalControlRequestRepository,
  StoredControlRequest,
} from "../langy-local-control-request.repository.ts";
import type { LangyLocalUserWaitRepository } from "../langy-local-user-wait.repository.ts";
import { LangyLocalCallMemoryRepository } from "../memory/memory.langy-local-call.repository.ts";
import { LangyLocalControlRequestMemoryRepository } from "../memory/memory.langy-local-control-request.repository.ts";
import { LangyLocalUserWaitMemoryRepository } from "../memory/memory.langy-local-user-wait.repository.ts";
import { LangyLocalCallRedisRepository } from "../redis/redis.langy-local-call.repository.ts";
import { LangyLocalControlRequestRedisRepository } from "../redis/redis.langy-local-control-request.repository.ts";
import { LangyLocalUserWaitRedisRepository } from "../redis/redis.langy-local-user-wait.repository.ts";

const conversationId = "conv_contract";
const turnId = "turn_contract";
const userId = "user_contract";

type Tier = {
  calls: LangyLocalCallRepository;
  waits: LangyLocalUserWaitRepository;
  requests: LangyLocalControlRequestRepository;
};

const tiers: { name: string; build: (now: () => number) => Tier }[] = [
  {
    name: "memory",
    build: (now) => ({
      calls: LangyLocalCallMemoryRepository.create({ now }),
      waits: LangyLocalUserWaitMemoryRepository.create({ now }),
      requests: LangyLocalControlRequestMemoryRepository.create({ now }),
    }),
  },
  {
    name: "redis",
    build: (now) => {
      const store = memorySessionState({ now });
      return {
        calls: LangyLocalCallRedisRepository.create({ store }),
        waits: LangyLocalUserWaitRedisRepository.create({ store }),
        requests: LangyLocalControlRequestRedisRepository.create({ store }),
      };
    },
  },
];

function call(callId: string): StoredLocalCall {
  return {
    callId,
    projectId: "proj_contract",
    conversationId,
    turnId,
    state: "pending",
    createdAt: 1_000,
    deadlineAt: 61_000,
    timeoutMs: 60_000,
    tool: "local_ls",
    params: { path: "." },
  };
}

function wait(waitId: string): StoredUserWait {
  return {
    waitId,
    projectId: "proj_contract",
    conversationId,
    turnId,
    kind: "question",
    state: "pending",
    createdAt: 1_000,
    expiresAt: 61_000,
    lastKeepaliveAt: 1_000,
  };
}

function request(id: string): StoredControlRequest {
  return {
    id,
    conversationId,
    conversationTitle: "Instrument tracing",
    conversationUrl: "/?langyConversation=conv_contract",
    projectId: "proj_contract",
    projectName: "Contract",
    userId,
    createdAt: 1_000,
    expiresAt: 901_000,
    command: "langwatch langy share",
  };
}

describe.each(tiers)("the $name local-control repositories", ({ build }) => {
  let now: number;
  let tier: Tier;

  beforeEach(() => {
    now = 1_000;
    tier = build(() => now);
  });

  describe("given a saved call", () => {
    it("reads it back until its expiry, then misses", async () => {
      await tier.calls.save({ call: call("call_1"), ttlSeconds: 10 });

      expect(await tier.calls.find("call_1")).toEqual({ kind: "hit", value: call("call_1") });
      now += 10_000;
      expect(await tier.calls.find("call_1")).toEqual({ kind: "miss" });
    });
  });

  describe("given calls in a conversation's pending set", () => {
    beforeEach(async () => {
      await tier.calls.trackPending({
        conversationId,
        callId: "late",
        expiresAt: 9_000,
        ttlSeconds: 60,
      });
      await tier.calls.trackPending({
        conversationId,
        callId: "soon",
        expiresAt: 5_000,
        ttlSeconds: 60,
      });
    });

    it("lists them soonest first from the given score", async () => {
      expect(await tier.calls.findPendingIds({ conversationId, from: 0 })).toEqual([
        "soon",
        "late",
      ]);
      expect(await tier.calls.findPendingIds({ conversationId, from: 6_000 })).toEqual(["late"]);
    });

    it("drops the lapsed ones and the untracked one", async () => {
      await tier.calls.dropLapsedPending({ conversationId, lapsedAt: 5_000 });
      expect(await tier.calls.findPendingIds({ conversationId, from: 0 })).toEqual(["late"]);
      await tier.calls.untrackPending({ conversationId, callId: "late" });
      expect(await tier.calls.findPendingIds({ conversationId, from: 0 })).toEqual([]);
    });

    it("forgets the whole set once its expiry passes", async () => {
      now += 60_000;
      expect(await tier.calls.findPendingIds({ conversationId, from: 0 })).toEqual([]);
    });
  });

  describe("when two replicas claim one call's keepalive window", () => {
    it("lets only the first write, until the window lapses", async () => {
      const claim = () =>
        tier.calls.claimKeepaliveWindow({ callId: "call_1", at: now, ttlSeconds: 5 });

      expect(await claim()).toBe(true);
      expect(await claim()).toBe(false);
      now += 5_000;
      expect(await claim()).toBe(true);
    });
  });

  describe("given a saved wait in its turn's pending set", () => {
    beforeEach(async () => {
      await tier.waits.save({ wait: wait("wait_1"), ttlSeconds: 60 });
      await tier.waits.trackPending({
        conversationId,
        turnId,
        waitId: "wait_1",
        expiresAt: 61_000,
        ttlSeconds: 60,
      });
    });

    it("reads it back and lists it", async () => {
      expect(await tier.waits.find("wait_1")).toEqual({ kind: "hit", value: wait("wait_1") });
      expect(await tier.waits.findPendingIds({ conversationId, turnId })).toEqual(["wait_1"]);
    });

    it("stops listing it once untracked, and misses it once expired", async () => {
      await tier.waits.untrackPending({ conversationId, turnId, waitId: "wait_1" });
      expect(await tier.waits.findPendingIds({ conversationId, turnId })).toEqual([]);
      now += 60_000;
      expect(await tier.waits.find("wait_1")).toEqual({ kind: "miss" });
    });
  });

  describe("given an open control request", () => {
    beforeEach(async () => {
      await tier.requests.saveRequest({ request: request("req_1"), ttlSeconds: 2_700 });
      await tier.requests.indexOpenRequest({
        userId,
        requestId: "req_1",
        expiresAt: 901_000,
        ttlSeconds: 2_700,
      });
    });

    it("reads it back and lists it for its user", async () => {
      expect(await tier.requests.findRequest("req_1")).toEqual({
        kind: "hit",
        value: request("req_1"),
      });
      expect(await tier.requests.findOpenRequestIds({ userId, from: now })).toEqual(["req_1"]);
    });

    it("drops it from the user's set once it lapses, while its record stays", async () => {
      await tier.requests.dropLapsedRequests({ userId, lapsedAt: 901_000 });
      expect(await tier.requests.findOpenRequestIds({ userId, from: 0 })).toEqual([]);
      expect((await tier.requests.findRequest("req_1")).kind).toBe("hit");
    });

    it("forgets both the record and the set member", async () => {
      await tier.requests.forgetRequest({ requestId: "req_1", userId });
      expect(await tier.requests.findRequest("req_1")).toEqual({ kind: "miss" });
      expect(await tier.requests.findOpenRequestIds({ userId, from: 0 })).toEqual([]);
    });

    it("is spent by exactly one claim", async () => {
      const claim = () =>
        tier.requests.claimRequest({ requestId: "req_1", userId, ttlSeconds: 900 });

      expect(await tier.requests.isClaimed("req_1")).toBe(false);
      expect(await claim()).toBe(true);
      expect(await claim()).toBe(false);
      expect(await tier.requests.isClaimed("req_1")).toBe(true);
    });
  });

  describe("given a key bound to a conversation", () => {
    const binding = { conversationId, projectId: "proj_contract", userId, requestId: "req_1" };

    beforeEach(async () => {
      await tier.requests.saveKeyBinding({ apiKeyId: "key_1", binding, ttlSeconds: 60 });
      await tier.requests.indexKeyBinding({
        conversationId,
        apiKeyId: "key_1",
        lapsesAt: 61_000,
        ttlSeconds: 60,
      });
    });

    it("reads the binding and lists the key under its conversation", async () => {
      expect(await tier.requests.findKeyBinding("key_1")).toEqual({ kind: "hit", value: binding });
      expect(await tier.requests.findKeyBindingIds(conversationId)).toEqual(["key_1"]);
    });

    it("misses the binding once deleted, and stops listing the key once unindexed", async () => {
      await tier.requests.deleteKeyBinding("key_1");
      await tier.requests.unindexKeyBinding({ conversationId, apiKeyId: "key_1" });
      expect(await tier.requests.findKeyBinding("key_1")).toEqual({ kind: "miss" });
      expect(await tier.requests.findKeyBindingIds(conversationId)).toEqual([]);
    });
  });
});
