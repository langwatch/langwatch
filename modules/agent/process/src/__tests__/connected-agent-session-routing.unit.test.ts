import type { StoredCall } from "@langwatch/agent-contract";
/**
 * The instance-agent fence a session reads a call through: an instance only
 * ever sees calls for the agents it registered itself (ADR-128, "No inbound access").
 * @see specs/agents/connected-agents.feature
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryConnectedAgentRelayChannel } from "../channels/memory/memory.connected-agent-relay.channel.ts";
import { MemoryConnectedAgentStateRepository } from "../repositories/memory/memory.connected-agent-state.repository.ts";
import { ConnectedAgentRuntimeService } from "../services/connected-agent-runtime.service.ts";
import {
  AgentSessionService,
  type SessionInfo,
} from "../services/connected-agent-session.service.ts";
import { createConnectedAgentFixture } from "./connected-agent.fixture.ts";

const projectId = "proj_1";
const instanceId = "inst_stranger";
const callId = "call_1";

const fakeAgents = createConnectedAgentFixture();
function build() {
  const state = MemoryConnectedAgentStateRepository.create();
  const runtime = ConnectedAgentRuntimeService.create({
    podId: "pod_solo",
    state,
    relay: MemoryConnectedAgentRelayChannel.create(),
  });
  const core = AgentSessionService.create({
    runtime,
    agents: fakeAgents,
    publicBaseUrl: "https://example.test",
    replicaCount: 1,
  });
  return { state, core };
}

function sessionRegisteredFor(agentId: string): SessionInfo {
  return {
    instanceId,
    projectId,
    principalId: "key:test",
    projectSlug: "proj-1",
    agentIds: new Set([agentId]),
    meta: {
      instanceId,
      projectId,
      hostname: "stranger-host",
      username: "dev",
      pid: 2,
      sdk: { name: "langwatch", version: "1.0.0", language: "python" },
      label: null,
      podId: "pod_solo",
      connectedAt: Date.now(),
      maxConcurrency: 8,
    },
  };
}

function storedCallFor(agentId: string): StoredCall {
  return {
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
      deadlineAt: Date.now() + 60_000,
      run: {},
    },
  };
}

describe("AgentSessionService.findCallForSession", () => {
  describe("when a call is routed at an instance that did not register the agent", () => {
    const stored = storedCallFor("agent_real");
    const session = sessionRegisteredFor("agent_stranger");
    let state: MemoryConnectedAgentStateRepository;
    let core: AgentSessionService;

    beforeEach(async () => {
      ({ state, core } = build());
      await state.saveCall({ call: stored, ttlSeconds: 60 });
    });

    /** @scenario "An instance never receives a call for an agent it did not register" */
    it("does not send the call or alter its delivery result", async () => {
      const call = await core.findCallForSession(session, callId);

      expect(call).toBeNull();
      expect(await state.readResult({ projectId, callId })).toEqual({ kind: "miss" });
    });

    /** @scenario "A session cannot alter calls for agents it did not register" */
    it("cannot acknowledge, answer or mark another agent's call undelivered", async () => {
      const acked = vi.spyOn(state, "markCallAcked");

      await core.ack(session, callId);
      await core.result(session, { type: "result", protocol: 1, callId, output: "forged" });
      await core.undeliver(session, callId);

      expect(acked).not.toHaveBeenCalled();
      expect(await state.readResult({ projectId, callId })).toEqual({ kind: "miss" });
      expect(await state.readCall({ projectId, callId })).toEqual({ kind: "hit", value: stored });
    });
  });
});
