/**
 * The HTTP long-poll transport with no datastore: the empty answer after
 * the poll wait, delivery once, and the refusal of a register when Redis is
 * absent on a deployment with several replicas.
 *
 * @see specs/agents/connected-agents.feature
 */
import { PROTOCOL_VERSION, type AgentService } from "@langwatch/agent-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  callKey,
  createMemoryStateStore,
  httpSessionKey,
  pendingKey,
} from "../../adapters/connected-agent-state.adapter";
import type { StoredCall } from "../../adapters/connected-agent-envelope.adapter";
import type { AgentRepository } from "../../repositories/agent.repository";
import type { ConnectCredentialPort } from "../../ports/connect-credential.port";
import { createConnectedAgentRuntime } from "../connected-agent-runtime.service";
import { AgentSessionCore } from "../connected-agent-session.service";
import { LongPollTransport } from "../connected-agent-long-poll.service";

const projectId = "project_poll";
const instanceId = "inst_poll";
const agentId = "agent_poll";
const token = "ait_test_token";

const credentials = {
  authorization: "Bearer sk-lw-test",
  projectId,
};

const fakeAgents = {} as AgentService;
const fakeAgentRepository = {} as AgentRepository;
const fakeCredentials = {} as ConnectCredentialPort;
const fakeAgentPlatformUrl = () => "https://example.test/agents";

function build({ pollWaitMs }: { pollWaitMs: number }) {
  const store = createMemoryStateStore();
  const runtime = createConnectedAgentRuntime({ podId: "pod_solo", store });
  const transport = new LongPollTransport({
    runtime,
    agents: fakeAgents,
    agentRepository: fakeAgentRepository,
    credentials: fakeCredentials,
    agentPlatformUrl: fakeAgentPlatformUrl,
    replicaCount: 1,
    pollWaitMs,
  });
  return { store, runtime, transport };
}

/** A session as the register route would have stored it. */
async function seedSession(store: ReturnType<typeof createMemoryStateStore>) {
  await store.set(
    httpSessionKey(token),
    JSON.stringify({
      token,
      instanceId,
      projectId,
      projectSlug: "poll",
      agentIds: [agentId],
      meta: {
        instanceId,
        projectId,
        hostname: "laptop",
        username: "dev",
        pid: 1,
        sdk: { name: "langwatch", version: "1.0.0", language: "python" },
        label: null,
        podId: "pod_solo",
        connectedAt: Date.now(),
        maxConcurrency: 1,
      },
    }),
    300,
  );
}

async function parkCall(store: ReturnType<typeof createMemoryStateStore>, callId: string) {
  const deadlineAt = Date.now() + 60_000;
  const stored: StoredCall = {
    projectId,
    instanceId,
    replyTo: "pod_caller",
    envelope: {
      callId,
      agentId,
      threadId: "thread_1",
      messages: [{ role: "user", content: "hi" }],
      newMessages: [{ role: "user", content: "hi" }],
      params: {},
      session: null,
      traceparent: null,
      deadlineAt,
      run: {},
    },
  };
  const ttl = 60 + 60;
  await store.set(callKey(callId), JSON.stringify(stored), ttl);
  await store.zadd({
    key: pendingKey(instanceId),
    score: deadlineAt,
    member: callId,
    ttlSeconds: ttl,
  });
}

const resolved = {
  project: { id: projectId, slug: "poll" },
  userId: null,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("LongPollTransport with a memory store", () => {
  describe("when nothing is pending for the instance", () => {
    /** @scenario "A poll with nothing pending answers empty after the poll wait" */
    it("answers no frame once the poll wait passes", async () => {
      const { store, transport } = build({ pollWaitMs: 120 });
      vi.spyOn(AgentSessionCore.prototype, "authenticate").mockResolvedValue(resolved);
      vi.spyOn(AgentSessionCore.prototype, "refreshPresence").mockResolvedValue(undefined);
      await seedSession(store);

      const started = Date.now();
      const answer = await transport.poll({
        credentials,
        token,
        inFlightCallIds: [],
      });

      expect(answer).toEqual({ frames: [] });
      expect(Date.now() - started).toBeGreaterThanOrEqual(100);
      await transport.close();
    });
  });

  describe("when a call is parked before the poll", () => {
    /** @scenario "A poll delivers a parked call once" */
    it("hands the call to the first poll and never again", async () => {
      const { store, transport } = build({ pollWaitMs: 50 });
      vi.spyOn(AgentSessionCore.prototype, "authenticate").mockResolvedValue(resolved);
      vi.spyOn(AgentSessionCore.prototype, "refreshPresence").mockResolvedValue(undefined);
      await seedSession(store);
      await parkCall(store, "call_1");

      const first = await transport.poll({
        credentials,
        token,
        inFlightCallIds: [],
      });
      const second = await transport.poll({
        credentials,
        token,
        inFlightCallIds: [],
      });

      expect(first.frames).toEqual([
        expect.objectContaining({
          type: "call",
          protocol: PROTOCOL_VERSION,
          callId: "call_1",
          agentId,
        }),
      ]);
      expect(second.frames).toEqual([]);
      await transport.close();
    });
  });

  describe("when the deployment has several replicas and no Redis", () => {
    /** @scenario "An HTTP register is refused without Redis on a deployment with several replicas" */
    it("refuses the register with replica_count_unsupported before any credential read", async () => {
      const store = createMemoryStateStore();
      const runtime = createConnectedAgentRuntime({ podId: "pod_solo", store });
      const transport = new LongPollTransport({
        runtime,
        agents: fakeAgents,
        agentRepository: fakeAgentRepository,
        credentials: fakeCredentials,
        agentPlatformUrl: fakeAgentPlatformUrl,
        replicaCount: 3,
      });

      const answer = await transport.register({
        credentials,
        body: { type: "register", protocol: PROTOCOL_VERSION },
      });

      expect(answer.status).toBe(503);
      expect(answer.body.frame).toMatchObject({
        type: "refused",
        code: "replica_count_unsupported",
      });
      await transport.close();
    });
  });
});
