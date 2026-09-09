import { createConnectedAgentFixture } from "./connected-agent.fixture.ts";
/**
 * The instance-agent fence a session reads a call through: an instance only
 * ever sees calls for the agents it registered itself (ADR-128, "No inbound access").
 * @see specs/agents/connected-agents.feature
 */
import { describe, expect, it } from "vitest";
import type { StoredCall } from "@langwatch/agent-contract";
import type { ConnectedAgentCredentials } from "../services/connected-agent-credential.service.ts";
import { SessionStateStoreFactory } from "@langwatch/redis-client";
import { callKey, callAckKey, resultKey } from "../rules/connected-agent-keys.rules.ts";
import { ConnectedAgentRuntimeService } from "../services/connected-agent-runtime.service.ts";
import {
  AgentSessionService,
  type SessionInfo,
} from "../services/connected-agent-session.service.ts";

const projectId = "proj_1";
const instanceId = "inst_stranger";
const callId = "call_1";

const fakeAgents = createConnectedAgentFixture();
const fakeCredentials: ConnectedAgentCredentials = {
  resolve: async () => {
    throw new Error("Credential lookup is not configured for this test");
  },
};

function build() {
  const store = SessionStateStoreFactory.memory();
  const runtime = ConnectedAgentRuntimeService.create({ podId: "pod_solo", store });
  const core = AgentSessionService.create({
    runtime,
    agents: fakeAgents,
    credentials: fakeCredentials,
    publicBaseUrl: "https://example.test",
    replicaCount: 1,
  });
  return { store, core };
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
    /** @scenario "An instance never receives a call for an agent it did not register" */
    it("does not send the call or alter its delivery result", async () => {
      const { store, core } = build();
      const stored = storedCallFor("agent_real");
      await store.set(callKey(projectId, callId), JSON.stringify(stored), 60);
      const session = sessionRegisteredFor("agent_stranger");

      const call = await core.findCallForSession(session, callId);

      expect(call).toBeNull();
      expect(await store.tryGet(resultKey(projectId, callId))).toBeNull();
    });

    /** @scenario "A session cannot alter calls for agents it did not register" */
    it("cannot acknowledge, answer or mark another agent's call undelivered", async () => {
      const { store, core } = build();
      const stored = storedCallFor("agent_real");
      const original = JSON.stringify(stored);
      await store.set(callKey(projectId, callId), original, 60);
      const session = sessionRegisteredFor("agent_stranger");

      await core.ack(session, callId);
      await core.result(session, { type: "result", protocol: 1, callId, output: "forged" });
      await core.undeliver(session, callId);

      expect(await store.tryGet(callAckKey(projectId, callId))).toBeNull();
      expect(await store.tryGet(resultKey(projectId, callId))).toBeNull();
      expect(await store.tryGet(callKey(projectId, callId))).toBe(original);
    });
  });
});
