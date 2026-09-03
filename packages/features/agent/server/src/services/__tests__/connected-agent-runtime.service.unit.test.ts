/**
 * The dispatcher against the in-memory store, with a fake instance that
 * plays the gateway's part: it reads envelopes off the store and writes acks
 * and results back the way the socket pod does.
 *
 * @see specs/agents/connected-agents.feature
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CALL_ENVELOPE_KEYS, RESULT_TTL_SECONDS } from "@langwatch/agent-contract";

import {
  buildCallEnvelope,
  type StoredResult,
  storedCallSchema,
} from "../../adapters/connected-agent-envelope.adapter";
import type { InstanceMeta } from "../../adapters/connected-agent-registry.adapter";
import {
  callAckKey,
  callKey,
  createMemoryStateStore,
  INSTANCE_GONE_CHANNEL,
  instanceChannel,
  replyChannel,
  resultKey,
} from "../../adapters/connected-agent-state.adapter";
import {
  type ConnectedAgentRuntime,
  createConnectedAgentRuntime,
} from "../connected-agent-runtime.service";

const projectId = "proj_1";

function meta(instanceId: string, maxConcurrency = 1): InstanceMeta {
  return {
    instanceId,
    projectId,
    hostname: `${instanceId}-host`,
    username: "dev",
    pid: 1,
    sdk: { name: "langwatch", version: "1.0.0", language: "python" },
    label: null,
    podId: "pod_a",
    connectedAt: Date.now(),
    maxConcurrency,
  };
}

function agent(overrides: Partial<{ id: string; timeoutMs: number; isSticky: boolean }> = {}) {
  return {
    id: overrides.id ?? "agent_1",
    name: "support-agent",
    environment: "production",
    timeoutMs: overrides.timeoutMs ?? 2_000,
    isSticky: overrides.isSticky ?? false,
  };
}

function call(threadId = "thread_1") {
  return {
    threadId,
    messages: [{ role: "user", content: "hi" }],
    newMessages: [{ role: "user", content: "hi" }],
    params: {},
    session: undefined,
    traceparent: null,
    run: {},
  };
}

/** A fake gateway for one instance: what it does with each call it sees. */
type InstanceBehavior = (
  callId: string,
  reply: {
    ack: () => Promise<void>;
    result: (result: Omit<StoredResult, "instanceId">) => Promise<void>;
    gone: () => Promise<void>;
  },
) => Promise<void> | void;

let runtime: ConnectedAgentRuntime;
let cleanups: (() => Promise<void>)[];

async function connectInstance({
  instanceId,
  maxConcurrency = 1,
  agentIds = ["agent_1"],
  behavior,
}: {
  instanceId: string;
  maxConcurrency?: number;
  agentIds?: string[];
  behavior: InstanceBehavior;
}): Promise<{ received: string[]; cancelled: string[] }> {
  const received: string[] = [];
  const cancelled: string[] = [];
  await runtime.registry.register({
    meta: meta(instanceId, maxConcurrency),
    agentIds,
  });
  const unsubscribe = await runtime.store.subscribe(instanceChannel(instanceId), (raw) => {
    const nudge = JSON.parse(raw) as { call?: string; cancel?: string };
    if (nudge.cancel) {
      cancelled.push(nudge.cancel);
      return;
    }
    const callId = nudge.call!;
    received.push(callId);
    void (async () => {
      const stored = storedCallSchema.parse(
        JSON.parse((await runtime.store.get(callKey(callId)))!),
      );
      await behavior(callId, {
        ack: async () => {
          await runtime.store.set(callAckKey(callId), "1", 60);
          await runtime.store.publish(
            replyChannel(stored.replyTo),
            JSON.stringify({ callId, kind: "ack" }),
          );
        },
        result: async (result) => {
          await runtime.store.set(
            resultKey(callId),
            JSON.stringify({ instanceId, ...result }),
            RESULT_TTL_SECONDS,
          );
          await runtime.store.publish(
            replyChannel(stored.replyTo),
            JSON.stringify({ callId, kind: "result" }),
          );
        },
        gone: async () => {
          await runtime.registry.deregister({
            projectId,
            instanceId,
            agentIds,
          });
          await runtime.store.publish(
            INSTANCE_GONE_CHANNEL,
            JSON.stringify({ instanceId, projectId }),
          );
        },
      });
    })();
  });
  cleanups.push(unsubscribe);
  return { received, cancelled };
}

async function startRuntime(overrides: { firstTurnGraceMs?: number } = {}): Promise<void> {
  runtime = createConnectedAgentRuntime({
    podId: "pod_a",
    store: createMemoryStateStore(),
    firstTurnGraceMs: 300,
    firstTurnPollMs: 20,
    resultPollMs: 50,
    ...overrides,
  });
  await runtime.dispatcher.start();
}

/** Replaces this test's runtime with one that has other knobs. */
async function useRuntime(overrides: { firstTurnGraceMs?: number }): Promise<void> {
  for (const cleanup of cleanups) await cleanup();
  cleanups = [];
  await runtime.dispatcher.close();
  await runtime.store.close();
  await startRuntime(overrides);
}

beforeEach(async () => {
  cleanups = [];
  await startRuntime();
});

afterEach(async () => {
  for (const cleanup of cleanups) await cleanup();
  await runtime.dispatcher.close();
  await runtime.store.close();
});

describe("CallDispatcher", () => {
  describe("when the instance answers", () => {
    it("returns the output, the session and the instance", async () => {
      await connectInstance({
        instanceId: "inst_1",
        behavior: async (_, reply) => {
          await reply.ack();
          await reply.result({ output: "hello", session: { turn: 1 } });
        },
      });

      const outcome = await runtime.dispatcher.dispatch({
        projectId,
        agent: agent(),
        call: call(),
      });

      expect(outcome.output).toBe("hello");
      expect(outcome.session).toEqual({ turn: 1 });
      expect(outcome.instance).toMatchObject({
        instanceId: "inst_1",
        hostname: "inst_1-host",
      });
    });
  });

  describe("when the frame never reached the instance", () => {
    /** @scenario "A call the platform proves never arrived runs on another instance" */
    it("dispatches the call again to the other instance", async () => {
      const first = await connectInstance({
        instanceId: "inst_1",
        maxConcurrency: 4,
        behavior: async (_, reply) => {
          // What the gateway writes when the socket went away between the
          // nudge and the write, so the frame never left the platform.
          await reply.result({ undelivered: true });
        },
      });
      const second = await connectInstance({
        instanceId: "inst_2",
        maxConcurrency: 4,
        behavior: async (_, reply) => {
          await reply.ack();
          await reply.result({ output: "from the second" });
        },
      });

      // Four threads: the rendezvous hash puts at least one on inst_1.
      const outcomes = await Promise.all(
        ["t1", "t2", "t3", "t4"].map((threadId) =>
          runtime.dispatcher.dispatch({
            projectId,
            agent: { ...agent(), timeoutMs: 3_000 },
            call: call(threadId),
          }),
        ),
      );

      expect(first.received.length).toBeGreaterThan(0);
      expect(outcomes.every((o) => o.output === "from the second")).toBe(true);
      expect(second.received.length).toBe(4);
    });
  });

  describe("when the instance goes away before it acknowledges", () => {
    /** @scenario "A delivered call whose instance goes away is never repeated" */
    it("fails with agent_disconnected and never reaches another instance", async () => {
      await connectInstance({
        instanceId: "inst_1",
        maxConcurrency: 4,
        behavior: async (_, reply) => {
          // The frame reached the socket. The function may have started, so
          // the turn is not placed again even with no acknowledgement.
          await reply.gone();
        },
      });
      const other = await connectInstance({
        instanceId: "inst_2",
        agentIds: ["agent_1"],
        behavior: async (_, reply) => {
          await reply.ack();
          await reply.result({ output: "never" });
        },
      });
      // Fill inst_2 so the pick lands on inst_1 for sure.
      await runtime.registry.incrementInflight("inst_2");

      await expect(
        runtime.dispatcher.dispatch({
          projectId,
          agent: agent(),
          call: call(),
        }),
      ).rejects.toMatchObject({ code: "agent_disconnected" });
      expect(other.received).toEqual([]);
    });
  });

  describe("when the instance goes away after it acknowledged", () => {
    /** @scenario "A call that was acknowledged is never repeated" */
    it("fails with agent_disconnected and never reaches another instance", async () => {
      await connectInstance({
        instanceId: "inst_1",
        maxConcurrency: 4,
        behavior: async (_, reply) => {
          await reply.ack();
          await reply.gone();
        },
      });
      const other = await connectInstance({
        instanceId: "inst_2",
        agentIds: ["agent_1"],
        behavior: async (_, reply) => {
          await reply.ack();
          await reply.result({ output: "never" });
        },
      });
      // Fill inst_2 so the pick lands on inst_1 for sure.
      await runtime.registry.incrementInflight("inst_2");

      await expect(
        runtime.dispatcher.dispatch({
          projectId,
          agent: agent(),
          call: call(),
        }),
      ).rejects.toMatchObject({ code: "agent_disconnected" });
      expect(other.received).toEqual([]);
    });
  });

  describe("when no instance is live", () => {
    /** @scenario "A call to an agent with no live instance is refused after the first-turn grace" */
    it("waits the grace, then fails with agent_offline", async () => {
      const started = Date.now();
      await expect(
        runtime.dispatcher.dispatch({
          projectId,
          agent: agent(),
          call: call(),
        }),
      ).rejects.toMatchObject({ code: "agent_offline" });
      expect(Date.now() - started).toBeGreaterThanOrEqual(250);
    });

    /** @scenario "An instance that connects inside the grace receives the call" */
    it("dispatches to an instance that appears inside the grace", async () => {
      // A grace far wider than the wait below, so a contended runner cannot
      // let the registration land after the grace expired.
      await useRuntime({ firstTurnGraceMs: 10_000 });
      const pending = runtime.dispatcher.dispatch({
        projectId,
        agent: agent(),
        call: call(),
      });
      await new Promise((resolve) => setTimeout(resolve, 80));
      await connectInstance({
        instanceId: "inst_late",
        behavior: async (_, reply) => {
          await reply.ack();
          await reply.result({ output: "late but here" });
        },
      });

      expect((await pending).output).toBe("late but here");
    });
  });

  describe("when the deadline passes", () => {
    /** @scenario "A call that reaches its deadline fails with a typed timeout" */
    it("fails with agent_call_timeout and cancels the call", async () => {
      const instance = await connectInstance({
        instanceId: "inst_slow",
        behavior: async (_, reply) => {
          await reply.ack();
        },
      });

      await expect(
        runtime.dispatcher.dispatch({
          projectId,
          agent: agent({ timeoutMs: 200 }),
          call: call(),
        }),
      ).rejects.toMatchObject({ code: "agent_call_timeout" });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(instance.cancelled).toEqual(instance.received);
    });
  });

  describe("when every instance is full", () => {
    /** @scenario "A call is refused when every instance is full" */
    it("fails with agent_busy and a retry delay", async () => {
      await connectInstance({
        instanceId: "inst_1",
        maxConcurrency: 1,
        behavior: async () => {},
      });
      await runtime.registry.incrementInflight("inst_1");

      await expect(
        runtime.dispatcher.dispatch({
          projectId,
          agent: agent(),
          call: call(),
        }),
      ).rejects.toMatchObject({
        code: "agent_busy",
        meta: { retryAfterMs: expect.any(Number) },
      });
    });
  });

  describe("when instances differ in free slots", () => {
    /** @scenario "The instance with the most free slots is picked" */
    it("picks the idle instance", async () => {
      const busy = await connectInstance({
        instanceId: "inst_busy",
        maxConcurrency: 2,
        behavior: async () => {},
      });
      await runtime.registry.incrementInflight("inst_busy");
      const idle = await connectInstance({
        instanceId: "inst_idle",
        maxConcurrency: 2,
        behavior: async (_, reply) => {
          await reply.ack();
          await reply.result({ output: "idle" });
        },
      });

      const outcome = await runtime.dispatcher.dispatch({
        projectId,
        agent: agent(),
        call: call(),
      });

      expect(outcome.output).toBe("idle");
      expect(busy.received).toEqual([]);
      expect(idle.received).toHaveLength(1);
    });
  });

  describe("when the agent is sticky", () => {
    /** @scenario "A sticky thread stays on its instance" */
    it("keeps later turns on the first instance", async () => {
      const answer =
        (label: string) =>
        async (
          _: string,
          reply: {
            ack: () => Promise<void>;
            result: (r: Omit<StoredResult, "instanceId">) => Promise<void>;
          },
        ) => {
          await reply.ack();
          await reply.result({ output: label });
        };
      const first = await connectInstance({
        instanceId: "inst_a",
        maxConcurrency: 4,
        behavior: answer("a"),
      });
      const second = await connectInstance({
        instanceId: "inst_b",
        maxConcurrency: 4,
        behavior: answer("b"),
      });

      const sticky = agent({ isSticky: true });
      const firstTurn = await runtime.dispatcher.dispatch({
        projectId,
        agent: sticky,
        call: call("thread_sticky"),
      });
      // Make the other instance the freer one; the pin must still win.
      const pinnedTo = firstTurn.instance.instanceId;
      const other = pinnedTo === "inst_a" ? "inst_b" : "inst_a";
      await runtime.registry.incrementInflight(pinnedTo);
      const secondTurn = await runtime.dispatcher.dispatch({
        projectId,
        agent: sticky,
        call: call("thread_sticky"),
      });

      expect(secondTurn.instance.instanceId).toBe(pinnedTo);
      const receivedBy = pinnedTo === "inst_a" ? first : second;
      const receivedByOther = other === "inst_a" ? first : second;
      expect(receivedBy.received).toHaveLength(2);
      expect(receivedByOther.received).toHaveLength(0);
    });

    /** @scenario "A sticky thread fails when its instance is gone" */
    it("fails the thread with agent_instance_lost when the pin is gone", async () => {
      await connectInstance({
        instanceId: "inst_a",
        behavior: async (_, reply) => {
          await reply.ack();
          await reply.result({ output: "a" });
        },
      });
      const sticky = agent({ isSticky: true });
      await runtime.dispatcher.dispatch({
        projectId,
        agent: sticky,
        call: call("thread_lost"),
      });
      await runtime.registry.deregister({
        projectId,
        instanceId: "inst_a",
        agentIds: ["agent_1"],
      });
      await connectInstance({
        instanceId: "inst_b",
        behavior: async (_, reply) => {
          await reply.ack();
          await reply.result({ output: "b" });
        },
      });

      await expect(
        runtime.dispatcher.dispatch({
          projectId,
          agent: sticky,
          call: call("thread_lost"),
        }),
      ).rejects.toMatchObject({ code: "agent_instance_lost" });
    });
  });

  describe("when the store refuses the write of the call", () => {
    /** @scenario "A call the store cannot write gives the instance slot back" */
    it("frees the slot so the next call is not refused as busy", async () => {
      await connectInstance({
        instanceId: "inst_1",
        maxConcurrency: 1,
        behavior: async (_, reply) => {
          await reply.ack();
          await reply.result({ output: "the call after the failure" });
        },
      });
      const zadd = runtime.store.zadd.bind(runtime.store);
      runtime.store.zadd = async () => {
        throw new Error("the store refused the pending write");
      };

      await expect(
        runtime.dispatcher.dispatch({
          projectId,
          agent: agent(),
          call: call(),
        }),
      ).rejects.toThrow("the store refused the pending write");

      runtime.store.zadd = zadd;
      const outcome = await runtime.dispatcher.dispatch({
        projectId,
        agent: agent(),
        call: call("thread_2"),
      });

      expect(outcome.output).toBe("the call after the failure");
    });
  });

  describe("when the gateway refuses an oversized payload", () => {
    it("raises agent_payload_too_large from the sizes the gateway measured", async () => {
      await connectInstance({
        instanceId: "inst_1",
        behavior: async (_, reply) => {
          await reply.ack();
          await reply.result({
            error: {
              code: "agent_payload_too_large",
              message: "copy the dispatcher never reads",
              payload: {
                what: "session",
                sizeBytes: 70_002,
                limitBytes: 65_536,
              },
            },
          });
        },
      });

      await expect(
        runtime.dispatcher.dispatch({
          projectId,
          agent: agent(),
          call: call(),
        }),
      ).rejects.toMatchObject({
        code: "agent_payload_too_large",
        meta: { what: "session", sizeBytes: 70_002, limitBytes: 65_536 },
      });
    });

    it("keeps a payload code an instance sends itself as a function failure", async () => {
      await connectInstance({
        instanceId: "inst_1",
        behavior: async (_, reply) => {
          await reply.ack();
          await reply.result({
            error: {
              code: "agent_payload_too_large",
              message: "The session is 1 bytes, above the limit of 2 bytes.",
            },
          });
        },
      });

      await expect(
        runtime.dispatcher.dispatch({
          projectId,
          agent: agent(),
          call: call(),
        }),
      ).rejects.toMatchObject({
        code: "agent_call_failed",
        meta: { remoteCode: "agent_payload_too_large" },
      });
    });
  });

  describe("when the function raises", () => {
    it("fails with agent_call_failed carrying the function's words", async () => {
      await connectInstance({
        instanceId: "inst_1",
        behavior: async (_, reply) => {
          await reply.ack();
          await reply.result({
            error: { code: "ValueError", message: "no such customer" },
          });
        },
      });

      await expect(
        runtime.dispatcher.dispatch({
          projectId,
          agent: agent(),
          call: call(),
        }),
      ).rejects.toMatchObject({
        code: "agent_call_failed",
        meta: { remoteCode: "ValueError", message: "no such customer" },
      });
    });
  });

  describe("when the instance already runs its declared number of calls", () => {
    /** @scenario "An instance that refuses a call as busy keeps the busy code" */
    it("refuses with agent_busy, the code a caller retries", async () => {
      await connectInstance({
        instanceId: "inst_1",
        behavior: async (_, reply) => {
          await reply.result({
            error: {
              code: "agent_busy",
              message: "support-agent already runs 4 call(s)",
            },
          });
        },
      });

      await expect(
        runtime.dispatcher.dispatch({
          projectId,
          agent: agent(),
          call: call(),
        }),
      ).rejects.toMatchObject({ code: "agent_busy" });
    });
  });
});

describe("buildCallEnvelope", () => {
  describe("when the relay body carries more than the contract", () => {
    /** @scenario "A call envelope carries only the contract fields" */
    it("writes exactly the ten contract keys", () => {
      const body = {
        callId: "call_1",
        agentId: "agent_1",
        threadId: "thread_1",
        messages: [{ role: "user", content: "hi" }],
        newMessages: [{ role: "user", content: "hi" }],
        params: { model: "gpt-5-mini" },
        session: null,
        traceparent: "00-abc-def-01",
        deadlineAt: 1,
        run: { scenarioRunId: "run_1" },
        judgmentRequest: { criteria: ["never leaks"] },
        metadata: { langwatch: { targetType: "connected" } },
      } as const;
      const envelope = buildCallEnvelope(body as never);
      expect(Object.keys(envelope).sort()).toEqual([...CALL_ENVELOPE_KEYS].sort());
      expect(envelope).not.toHaveProperty("judgmentRequest");
      expect(envelope).not.toHaveProperty("metadata");
    });
  });
});
