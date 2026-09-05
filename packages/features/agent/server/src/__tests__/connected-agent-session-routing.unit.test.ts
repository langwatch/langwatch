/**
 * The instance-agent fence a session reads a call through: an instance only
 * ever sees calls for the agents it registered itself (ADR-128, "No inbound access").
 * @see specs/agents/connected-agents.feature
 */
import type { AgentService } from "@langwatch/agent-contract";
import { describe, expect, it } from "vitest";
import type { StoredCall, StoredResult } from "../services/connected-agent-envelope.service";
import type { AgentRepository } from "../repositories/agent.repository";
import type { ConnectCredentialPort } from "../ports/connect-credential.port";
import { ConnectedAgentStateAdapter } from "../adapters/connected-agent-state.adapter";
import { callKey, resultKey } from "../rules/connected-agent-keys.rules";
import { ConnectedAgentRuntimeAdapter } from "../adapters/connected-agent-runtime.adapter";
import { AgentSessionService, type SessionInfo } from "../services/connected-agent-session.service";

const projectId = "proj_1";
const instanceId = "inst_stranger";
const callId = "call_1";

const fakeAgents = {} as AgentService;
const fakeAgentRepository = {} as AgentRepository;
const fakeCredentials = {} as ConnectCredentialPort;
const fakeAgentPlatformUrl = () => "https://example.test/agents";

function build() {
  const store = ConnectedAgentStateAdapter.memory();
  const runtime = ConnectedAgentRuntimeAdapter.create({ podId: "pod_solo", store });
  const core = AgentSessionService.create({
    runtime,
    agents: fakeAgents,
    agentRepository: fakeAgentRepository,
    credentials: fakeCredentials,
    agentPlatformUrl: fakeAgentPlatformUrl,
    replicaCount: 1,
  });
  return { store, core };
}

function sessionRegisteredFor(agentId: string): SessionInfo {
  return {
    instanceId,
    projectId,
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

describe("AgentSessionService.readCallForSession", () => {
  describe("when a call is routed at an instance that did not register the agent", () => {
    /** @scenario "An instance never receives a call for an agent it did not register" */
    it("does not send the call to it and marks it undelivered", async () => {
      const { store, core } = build();
      const stored = storedCallFor("agent_real");
      await store.set(callKey(projectId, callId), JSON.stringify(stored), 60);
      const session = sessionRegisteredFor("agent_stranger");

      const call = await core.readCallForSession(session, callId);

      expect(call).toBeNull();
      const result = JSON.parse(
        (await store.get(resultKey(projectId, callId))) ?? "null",
      ) as StoredResult | null;
      expect(result).toMatchObject({ instanceId, undelivered: true });
    });
  });
});
