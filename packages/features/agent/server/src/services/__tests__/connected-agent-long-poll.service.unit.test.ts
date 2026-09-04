/**
 * The HTTP long-poll transport with no datastore: the empty answer after
 * the poll wait, delivery once, and the refusal of a register when Redis is
 * absent on a deployment with several replicas.
 *
 * @see specs/agents/connected-agents.feature
 */
import {
  AgentOfflineError,
  AgentRegisterRefusedError,
  AgentSessionUnknownError,
  PRESENCE_TTL_SECONDS,
  PROTOCOL_VERSION,
  type Agent,
  type AgentService,
} from "@langwatch/agent-contract";
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
    httpSessionKey(projectId, token),
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
  await store.set(callKey(projectId, callId), JSON.stringify(stored), ttl);
  await store.zadd({
    key: pendingKey(projectId, instanceId),
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

/** A fake `AgentService` that upserts nothing, just echoes what it was given. */
function registeringAgentService(): AgentService {
  return {
    registerConnected: async (input) =>
      ({
        id: input.id,
        name: input.name,
        environment: input.identity.environment,
        type: "connected",
      }) as unknown as Agent,
  } as unknown as AgentService;
}

function registerFrameBody(overrides: { name?: string; instanceId?: string } = {}) {
  return {
    type: "register" as const,
    protocol: PROTOCOL_VERSION,
    sdk: { name: "langwatch", version: "1.0.0", language: "python" },
    instance: {
      id: overrides.instanceId ?? instanceId,
      hostname: "laptop",
      username: "dev",
      pid: 1,
      startedAt: new Date().toISOString(),
      inFlightCallIds: [],
    },
    agents: [{ name: overrides.name ?? "support-agent", environment: "production", parameters: {} }],
  };
}

describe("LongPollTransport registration and polling, against a memory store", () => {
  describe("when an SDK process whose network blocks WebSockets registers", () => {
    /** @scenario "A register over HTTP creates the rows and answers with an instance token" */
    it("creates an agent row for each agent of the frame and answers with an instance token", async () => {
      vi.spyOn(AgentSessionCore.prototype, "authenticate").mockResolvedValue(resolved);
      const agents = registeringAgentService();
      const registerSpy = vi.spyOn(agents, "registerConnected");
      const runtime = createConnectedAgentRuntime({ podId: "pod_solo", store: createMemoryStateStore() });
      const registeringTransport = new LongPollTransport({
        runtime,
        agents,
        agentRepository: fakeAgentRepository,
        credentials: fakeCredentials,
        agentPlatformUrl: fakeAgentPlatformUrl,
        replicaCount: 1,
      });

      const answer = await registeringTransport.register({
        credentials,
        body: registerFrameBody(),
      });

      expect(answer.status).toBe(200);
      expect(answer.body.frame.type).toBe("registered");
      expect(answer.body.instanceToken).toMatch(/^ait_/);
      expect(registerSpy).toHaveBeenCalledTimes(1);
      await registeringTransport.close();
    });
  });

  describe("when the credentials are refused the same way the socket refuses them", () => {
    /** @scenario "The HTTP transport refuses the same credentials as the socket" */
    it("answers a refused frame naming the reason", async () => {
      const runtime = createConnectedAgentRuntime({ podId: "pod_solo", store: createMemoryStateStore() });
      const permissionDenied = new LongPollTransport({
        runtime,
        agents: fakeAgents,
        agentRepository: fakeAgentRepository,
        credentials: {
          resolve: async () => {
            throw new AgentRegisterRefusedError({
              reason: "permission_denied",
              message: "The API key needs the scenarios:manage permission to connect an agent.",
            });
          },
        },
        agentPlatformUrl: fakeAgentPlatformUrl,
        replicaCount: 1,
      });
      const viewOnly = await permissionDenied.register({
        credentials,
        body: registerFrameBody(),
      });
      expect(viewOnly.body.frame).toMatchObject({ type: "refused", code: "permission_denied" });
      await permissionDenied.close();

      const ingestion = new LongPollTransport({
        runtime,
        agents: fakeAgents,
        agentRepository: fakeAgentRepository,
        credentials: {
          resolve: async () => {
            throw new AgentRegisterRefusedError({
              reason: "key_type_not_allowed",
              message: "An ingestion key or a Langy session key cannot connect an agent.",
            });
          },
        },
        agentPlatformUrl: fakeAgentPlatformUrl,
        replicaCount: 1,
      });
      const ingestAnswer = await ingestion.register({ credentials, body: registerFrameBody() });
      expect(ingestAnswer.body.frame).toMatchObject({
        type: "refused",
        code: "key_type_not_allowed",
      });
      await ingestion.close();
      await runtime.store.close?.();
    });
  });

  describe("when a registered instance polls", () => {
    /** @scenario "A poll refreshes presence" */
    it("is live for its agent, and a read after the TTL with no poll finds it offline", async () => {
      let now = Date.now();
      const store = createMemoryStateStore({ now: () => now });
      const runtime = createConnectedAgentRuntime({ podId: "pod_solo", store, resultPollMs: 20 });
      const agents = registeringAgentService();
      const transport = new LongPollTransport({
        runtime,
        agents,
        agentRepository: fakeAgentRepository,
        credentials: fakeCredentials,
        agentPlatformUrl: fakeAgentPlatformUrl,
        replicaCount: 1,
        pollWaitMs: 20,
        now: () => now,
      });
      vi.spyOn(AgentSessionCore.prototype, "authenticate").mockResolvedValue(resolved);

      const registered = await transport.register({ credentials, body: registerFrameBody() });
      const registeredAgentId = (
        registered.body.frame as { agents: { id: string }[] }
      ).agents[0]?.id;
      const token = registered.body.instanceToken as string;

      await transport.poll({ credentials, token, inFlightCallIds: [] });

      const liveAfterPoll = await runtime.registry.listLive({
        projectId,
        agentId: registeredAgentId as string,
        now,
      });
      expect(liveAfterPoll).toHaveLength(1);

      now += (PRESENCE_TTL_SECONDS + 1) * 1000;
      const liveAfterTtlWithNoPoll = await runtime.registry.listLive({
        projectId,
        agentId: registeredAgentId as string,
        now,
      });
      expect(liveAfterTtlWithNoPoll).toEqual([]);

      await transport.close();
    });
  });

  describe("when a poll is made with an instance token the platform does not know", () => {
    /** @scenario "A poll with an unknown instance token asks the process to register again" */
    it("answers agent_session_unknown", async () => {
      const { transport } = build({ pollWaitMs: 50 });
      vi.spyOn(AgentSessionCore.prototype, "authenticate").mockResolvedValue(resolved);

      const failure = await transport
        .poll({ credentials, token: "ait_unknown", inFlightCallIds: [] })
        .catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(AgentSessionUnknownError);
      await transport.close();
    });
  });

  describe("when an instance registered over HTTP stops polling", () => {
    /** @scenario "A process that stops polling goes offline after the presence TTL" */
    it("fails a call dispatched to its agent with agent_offline", async () => {
      const store = createMemoryStateStore();
      const runtime = createConnectedAgentRuntime({
        podId: "pod_solo",
        store,
        firstTurnGraceMs: 10,
        firstTurnPollMs: 5,
      });
      const agents = registeringAgentService();
      const transport = new LongPollTransport({
        runtime,
        agents,
        agentRepository: fakeAgentRepository,
        credentials: fakeCredentials,
        agentPlatformUrl: fakeAgentPlatformUrl,
        replicaCount: 1,
        pollWaitMs: 10,
      });
      vi.spyOn(AgentSessionCore.prototype, "authenticate").mockResolvedValue(resolved);

      const registered = await transport.register({ credentials, body: registerFrameBody() });
      const registeredAgentId = (
        registered.body.frame as { agents: { id: string }[] }
      ).agents[0]?.id as string;

      // No poll came in: force the instance's last-seen score past the
      // presence TTL, the way a stalled process reads once no watch's clock
      // extends it.
      const { instanceSetKey } = await import("../../adapters/connected-agent-state.adapter");
      await store.zadd({
        key: instanceSetKey(projectId, registeredAgentId),
        score: Date.now() - (PRESENCE_TTL_SECONDS + 5) * 1000,
        member: instanceId,
        ttlSeconds: 1,
      });

      const failure = await runtime.dispatcher
        .dispatch({
          projectId,
          agent: {
            id: registeredAgentId,
            name: "support-agent",
            environment: "production",
            timeoutMs: 300,
            isSticky: false,
          },
          call: {
            threadId: "thread_1",
            messages: [{ role: "user", content: "hi" }],
            newMessages: [{ role: "user", content: "hi" }],
            params: {},
            session: undefined,
            traceparent: null,
            run: {},
          },
        })
        .catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(AgentOfflineError);
      await transport.close();
    });
  });
});

/** One instance registered over HTTP, with a real dispatcher call in flight. */
async function registerAndDispatch(signal?: AbortSignal) {
  const store = createMemoryStateStore();
  const runtime = createConnectedAgentRuntime({ podId: "pod_solo", store, resultPollMs: 15 });
  const agents = registeringAgentService();
  const transport = new LongPollTransport({
    runtime,
    agents,
    agentRepository: fakeAgentRepository,
    credentials: fakeCredentials,
    agentPlatformUrl: fakeAgentPlatformUrl,
    replicaCount: 1,
    pollWaitMs: 200,
  });
  vi.spyOn(AgentSessionCore.prototype, "authenticate").mockResolvedValue(resolved);
  const registered = await transport.register({ credentials, body: registerFrameBody() });
  const registeredAgentId = (
    registered.body.frame as { agents: { id: string }[] }
  ).agents[0]?.id as string;
  const token = registered.body.instanceToken as string;

  const dispatched = runtime.dispatcher.dispatch({
    projectId,
    agent: {
      id: registeredAgentId,
      name: "support-agent",
      environment: "production",
      timeoutMs: 5_000,
      isSticky: false,
    },
    call: {
      threadId: "thread_1",
      messages: [{ role: "user", content: "hi" }],
      newMessages: [{ role: "user", content: "hi" }],
      params: {},
      session: undefined,
      traceparent: null,
      run: {},
    },
    signal,
  });

  const poll = await transport.poll({ credentials, token, inFlightCallIds: [] });
  const callId = (poll.frames[0] as { callId: string }).callId;

  return { transport, dispatched, callId, token };
}

describe("LongPollTransport dispatch through a real call", () => {
  describe("when an instance that received a call by poll answers it", () => {
    /** @scenario "A result posted over HTTP answers the dispatcher" */
    it("returns the output of the result to the dispatcher", async () => {
      const { transport, dispatched, callId, token } = await registerAndDispatch();

      await transport.frames({
        credentials,
        token,
        frames: [
          { type: "ack", protocol: PROTOCOL_VERSION, callId },
          { type: "result", protocol: PROTOCOL_VERSION, callId, output: "the answer" },
        ],
      });

      const outcome = await dispatched;
      expect(outcome.output).toBe("the answer");
      await transport.close();
    });
  });

  describe("when an instance that received a call by poll and acknowledged it has its relay request aborted", () => {
    /** @scenario "A cancel reaches a polling instance" */
    it("answers the next poll with a cancel frame for that call", async () => {
      const controller = new AbortController();
      const { transport, dispatched, callId, token } = await registerAndDispatch(
        controller.signal,
      );

      await transport.frames({
        credentials,
        token,
        frames: [{ type: "ack", protocol: PROTOCOL_VERSION, callId }],
      });

      controller.abort();
      await dispatched.catch(() => undefined);

      const nextPoll = await transport.poll({
        credentials,
        token,
        inFlightCallIds: [callId],
      });

      expect(
        nextPoll.frames.some((frame) => frame.type === "cancel" && frame.callId === callId),
      ).toBe(true);
      await transport.close();
    });
  });

  describe("when an instance registered over HTTP posts a deregister frame", () => {
    /** @scenario "A deregister posted over HTTP retires the instance at once" */
    it("is no longer live, and a poll with its instance token answers agent_session_unknown", async () => {
      const { transport, dispatched, callId, token } = await registerAndDispatch();

      await transport.frames({
        credentials,
        token,
        frames: [
          { type: "ack", protocol: PROTOCOL_VERSION, callId },
          { type: "deregister", protocol: PROTOCOL_VERSION },
        ],
      });

      const failure = await transport
        .poll({ credentials, token, inFlightCallIds: [] })
        .catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(AgentSessionUnknownError);

      const dispatchFailure = await dispatched.catch((error: unknown) => error);
      expect(dispatchFailure).toBeTruthy();
      await transport.close();
    });
  });
});
