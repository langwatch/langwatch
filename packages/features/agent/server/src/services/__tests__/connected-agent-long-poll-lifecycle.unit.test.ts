/**
 * The rest of the HTTP long-poll transport's lifecycle: a call answered
 * through the frames endpoint, a cancel delivered on the next poll, a
 * deregister that retires the instance at once, an unknown token, an
 * instance that stopped polling, and the two ways a frames body is refused
 * (ADR-128, "Transport").
 *
 * @see specs/agents/connected-agents.feature
 */
import {
  AgentSessionUnknownError,
  PRESENCE_TTL_SECONDS,
  PROTOCOL_VERSION,
  type Agent,
  type AgentService,
} from "@langwatch/agent-contract";
import { describe, expect, it, vi } from "vitest";
import { createMemoryStateStore } from "../../adapters/connected-agent-state.adapter";
import type { AgentRepository } from "../../repositories/agent.repository";
import type { ConnectCredentialPort } from "../../ports/connect-credential.port";
import { createConnectedAgentRuntime } from "../connected-agent-runtime.service";
import { AgentSessionCore } from "../connected-agent-session.service";
import { LongPollTransport } from "../connected-agent-long-poll.service";

const projectId = "project_poll_lifecycle";
const instanceId = "inst_poll_lifecycle";

const credentials = { authorization: "Bearer sk-lw-test", projectId };
const resolved = { project: { id: projectId, slug: "poll-lifecycle" }, userId: null };

const fakeAgents = {} as AgentService;
const fakeAgentRepository = { touchLastSeenAt: async () => undefined } as AgentRepository;
const fakeCredentials = {} as ConnectCredentialPort;
const fakeAgentPlatformUrl = () => "https://example.test/agents";

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

function registerFrameBody() {
  return {
    type: "register" as const,
    protocol: PROTOCOL_VERSION,
    sdk: { name: "langwatch", version: "1.0.0", language: "python" },
    instance: {
      id: instanceId,
      hostname: "laptop",
      username: "dev",
      pid: 1,
      startedAt: new Date().toISOString(),
      inFlightCallIds: [],
    },
    agents: [{ name: "support-agent", environment: "production", parameters: {} }],
  };
}

/** Registers one instance through the transport and returns its id, token and dispatch agent. */
async function registerInstance(transport: LongPollTransport) {
  const answer = await transport.register({ credentials, body: registerFrameBody() });
  const agentId = (answer.body.frame as { agents: { id: string }[] }).agents[0]!.id;
  const token = answer.body.instanceToken as string;
  return {
    agentId,
    token,
    dispatchAgent: {
      id: agentId,
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
  };
}

describe("LongPollTransport lifecycle, against a memory store", () => {
  describe("when an instance received a call by poll", () => {
    /** @scenario "A result posted over HTTP answers the dispatcher" */
    it("answers the dispatcher's outcome once it posts an ack and a result", async () => {
      vi.spyOn(AgentSessionCore.prototype, "authenticate").mockResolvedValue(resolved);
      const runtime = createConnectedAgentRuntime({ podId: "pod_solo", store: createMemoryStateStore() });
      const transport = new LongPollTransport({
        runtime,
        agents: registeringAgentService(),
        agentRepository: fakeAgentRepository,
        credentials: fakeCredentials,
        agentPlatformUrl: fakeAgentPlatformUrl,
        replicaCount: 1,
        pollWaitMs: 2_000,
      });
      const { token, dispatchAgent, call } = await registerInstance(transport);

      const outcome = runtime.dispatcher.dispatch({ projectId, agent: dispatchAgent, call });
      const poll = await transport.poll({ credentials, token, inFlightCallIds: [] });
      const callId = poll.frames[0]!.callId;

      await transport.frames({
        credentials,
        token,
        frames: [
          { type: "ack", protocol: PROTOCOL_VERSION, callId },
          { type: "result", protocol: PROTOCOL_VERSION, callId, output: "answered by poll" },
        ],
      });

      await expect(outcome).resolves.toMatchObject({ output: "answered by poll" });
      await transport.close();
      vi.restoreAllMocks();
    });
  });

  describe("when the relay request is aborted for an instance that acknowledged by poll", () => {
    /** @scenario "A cancel reaches a polling instance" */
    it("answers the next poll with a cancel frame for that call", async () => {
      vi.spyOn(AgentSessionCore.prototype, "authenticate").mockResolvedValue(resolved);
      const runtime = createConnectedAgentRuntime({ podId: "pod_solo", store: createMemoryStateStore() });
      const transport = new LongPollTransport({
        runtime,
        agents: registeringAgentService(),
        agentRepository: fakeAgentRepository,
        credentials: fakeCredentials,
        agentPlatformUrl: fakeAgentPlatformUrl,
        replicaCount: 1,
        pollWaitMs: 2_000,
      });
      const { token, dispatchAgent, call } = await registerInstance(transport);
      const controller = new AbortController();

      const outcome = runtime.dispatcher.dispatch({
        projectId,
        agent: dispatchAgent,
        call,
        signal: controller.signal,
      });
      const firstPoll = await transport.poll({ credentials, token, inFlightCallIds: [] });
      const callId = firstPoll.frames[0]!.callId;
      await transport.frames({
        credentials,
        token,
        frames: [{ type: "ack", protocol: PROTOCOL_VERSION, callId }],
      });
      controller.abort();
      await expect(outcome).rejects.toThrow();

      const secondPoll = await transport.poll({
        credentials,
        token,
        inFlightCallIds: [callId],
      });

      expect(secondPoll.frames).toEqual([
        { type: "cancel", protocol: PROTOCOL_VERSION, callId },
      ]);
      await transport.close();
      vi.restoreAllMocks();
    });
  });

  describe("when an instance registered over HTTP posts a deregister frame", () => {
    /** @scenario "A deregister posted over HTTP retires the instance at once" */
    it("is no longer live and the token answers agent_session_unknown", async () => {
      vi.spyOn(AgentSessionCore.prototype, "authenticate").mockResolvedValue(resolved);
      const runtime = createConnectedAgentRuntime({ podId: "pod_solo", store: createMemoryStateStore() });
      const transport = new LongPollTransport({
        runtime,
        agents: registeringAgentService(),
        agentRepository: fakeAgentRepository,
        credentials: fakeCredentials,
        agentPlatformUrl: fakeAgentPlatformUrl,
        replicaCount: 1,
        pollWaitMs: 200,
      });
      const { token, agentId } = await registerInstance(transport);

      await transport.frames({
        credentials,
        token,
        frames: [{ type: "deregister", protocol: PROTOCOL_VERSION }],
      });

      expect(await runtime.registry.listLive({ projectId, agentId })).toEqual([]);
      await expect(
        transport.poll({ credentials, token, inFlightCallIds: [] }),
      ).rejects.toBeInstanceOf(AgentSessionUnknownError);
      await transport.close();
      vi.restoreAllMocks();
    });
  });

  describe("when a poll names an instance token the platform does not know", () => {
    /** @scenario "A poll with an unknown instance token asks the process to register again" */
    it("answers agent_session_unknown with status 410", async () => {
      vi.spyOn(AgentSessionCore.prototype, "authenticate").mockResolvedValue(resolved);
      const { transport } = build();

      const error = await transport
        .poll({ credentials, token: "ait_unknown", inFlightCallIds: [] })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(AgentSessionUnknownError);
      expect((error as AgentSessionUnknownError).httpStatus).toBe(410);
      await transport.close();
      vi.restoreAllMocks();
    });
  });

  describe("when an instance registered over HTTP has not polled since before the presence TTL", () => {
    /** @scenario "A process that stops polling goes offline after the presence TTL" */
    it("fails a call dispatched to its agent with agent_offline", async () => {
      let now = Date.now();
      vi.spyOn(AgentSessionCore.prototype, "authenticate").mockResolvedValue(resolved);
      const store = createMemoryStateStore({ now: () => now });
      const runtime = createConnectedAgentRuntime({
        podId: "pod_solo",
        store,
        firstTurnGraceMs: 20,
        firstTurnPollMs: 5,
      });
      const transport = new LongPollTransport({
        runtime,
        agents: registeringAgentService(),
        agentRepository: fakeAgentRepository,
        credentials: fakeCredentials,
        agentPlatformUrl: fakeAgentPlatformUrl,
        replicaCount: 1,
        pollWaitMs: 20,
        now: () => now,
      });
      const { dispatchAgent, call } = await registerInstance(transport);

      now += (PRESENCE_TTL_SECONDS + 1) * 1000;

      await expect(
        runtime.dispatcher.dispatch({ projectId, agent: dispatchAgent, call }),
      ).rejects.toMatchObject({ code: "agent_offline" });
      await transport.close();
      vi.restoreAllMocks();
    });
  });
});

function build() {
  const store = createMemoryStateStore();
  const runtime = createConnectedAgentRuntime({ podId: "pod_solo", store });
  const transport = new LongPollTransport({
    runtime,
    agents: fakeAgents,
    agentRepository: fakeAgentRepository,
    credentials: fakeCredentials,
    agentPlatformUrl: fakeAgentPlatformUrl,
    replicaCount: 1,
  });
  return { store, runtime, transport };
}
