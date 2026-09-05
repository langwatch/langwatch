/**
 * The project fence of connected agents: the instance id is chosen by the connecting
 * process, so a session of one project must never read, drain or answer a call of another.
 * @see specs/agents/connected-agents.feature
 */
import {
  AgentCallForeignProjectError,
  CALL_KEY_SLACK_SECONDS,
  type AgentService,
} from "@langwatch/agent-contract";
import { describe, expect, it, vi } from "vitest";

import type { StoredCall } from "../services/connected-agent-envelope.service";
import type { AgentRepository } from "../repositories/agent.repository";
import type { ConnectCredentialPort } from "../ports/connect-credential.port";
import { ConnectedAgentStateAdapter } from "../adapters/connected-agent-state.adapter";
import type { AgentStateStorePort } from "../ports/agent-state-store.port";
import {
  callAckKey,
  callKey,
  httpSessionKey,
  pendingKey,
  resultKey,
} from "../rules/connected-agent-keys.rules";
import { ConnectedAgentRuntimeAdapter } from "../adapters/connected-agent-runtime.adapter";
import { AgentSessionService, type SessionInfo } from "../services/connected-agent-session.service";
import { LongPollTransportService } from "../services/connected-agent-long-poll.service";

const victimProjectId = "project_victim";
const attackerProjectId = "project_attacker";
const instanceId = "inst_shared";
const agentId = "agent_victim";
const callId = "call_victim";
const token = "ait_attacker_token";

const fakeAgents = {} as AgentService;
const fakeAgentRepository = {} as AgentRepository;
const fakeCredentials = {} as ConnectCredentialPort;
const fakeAgentPlatformUrl = () => "https://example.test/agents";

type MemoryStore = AgentStateStorePort;

function build() {
  const store = ConnectedAgentStateAdapter.memory();
  const runtime = ConnectedAgentRuntimeAdapter.create({ podId: "pod_solo", store });
  const options = {
    runtime,
    agents: fakeAgents,
    agentRepository: fakeAgentRepository,
    credentials: fakeCredentials,
    agentPlatformUrl: fakeAgentPlatformUrl,
    replicaCount: 1,
  };
  return { store, runtime, options };
}

function sessionOf(projectId: string): SessionInfo {
  return {
    instanceId,
    projectId,
    projectSlug: projectId,
    agentIds: new Set([agentId]),
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
  };
}

function storedCallOf(projectId: string): StoredCall {
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

const ttlSeconds = 60 + CALL_KEY_SLACK_SECONDS;

/** Parks a call written by `writtenBy` under the keys of `readableBy`. */
async function parkCall({
  store,
  writtenBy,
  readableBy,
}: {
  store: MemoryStore;
  writtenBy: string;
  readableBy: string;
}) {
  const stored = storedCallOf(writtenBy);
  await store.set(callKey(readableBy, callId), JSON.stringify(stored), ttlSeconds);
  await store.zadd({
    key: pendingKey(readableBy, instanceId),
    score: stored.envelope.deadlineAt,
    member: callId,
    ttlSeconds,
  });
}

describe("the project fence of connected agent state", () => {
  describe("when the same call id exists in two projects", () => {
    /** @scenario "A call key of one project never names another project's call" */
    it("builds a different key per project, each carrying its own project id", () => {
      const victimKey = callKey(victimProjectId, callId);
      const attackerKey = callKey(attackerProjectId, callId);

      expect(victimKey).not.toBe(attackerKey);
      expect(victimKey).toContain(victimProjectId);
      expect(attackerKey).toContain(attackerProjectId);
      expect(pendingKey(victimProjectId, instanceId)).not.toBe(
        pendingKey(attackerProjectId, instanceId),
      );
      expect(resultKey(victimProjectId, callId)).not.toBe(resultKey(attackerProjectId, callId));
    });
  });

  describe("when a session acknowledges a call of another project", () => {
    /** @scenario "An ack for a call of another project is refused" */
    it("refuses the frame and does not mark the call as started", async () => {
      const { store, options } = build();
      const core = AgentSessionService.create(options);
      // The envelope of the victim's call, reachable under the attacker's own
      // key: the fence has to hold on the envelope, not only on the key.
      await parkCall({ store, writtenBy: victimProjectId, readableBy: attackerProjectId });

      await expect(core.ack(sessionOf(attackerProjectId), callId)).rejects.toBeInstanceOf(
        AgentCallForeignProjectError,
      );
      expect(await store.get(callAckKey(attackerProjectId, callId))).toBeNull();
      expect(await store.get(callAckKey(victimProjectId, callId))).toBeNull();
    });

    /** @scenario "An ack for a call of another project is refused" */
    it("refuses a result frame and writes no result for the other project", async () => {
      const { store, options } = build();
      const core = AgentSessionService.create(options);
      await parkCall({ store, writtenBy: victimProjectId, readableBy: attackerProjectId });

      await expect(
        core.result(sessionOf(attackerProjectId), {
          type: "result",
          protocol: 1,
          callId,
          output: "attacker output",
          session: null,
        }),
      ).rejects.toMatchObject({ code: "agent_call_foreign_project" });
      expect(await store.get(resultKey(victimProjectId, callId))).toBeNull();
      expect(await store.get(resultKey(attackerProjectId, callId))).toBeNull();
    });
  });

  describe("when a session acknowledges a call of its own project", () => {
    /** @scenario "An ack for a call of the instance's own project is taken" */
    it("marks the call as started", async () => {
      const { store, options } = build();
      const core = AgentSessionService.create(options);
      await parkCall({ store, writtenBy: victimProjectId, readableBy: victimProjectId });

      await core.ack(sessionOf(victimProjectId), callId);

      expect(await store.get(callAckKey(victimProjectId, callId))).toBe("1");
    });
  });

  describe("when a process of another project polls with the same instance id", () => {
    /** @scenario "A poll from another project leaves the calls of an instance untouched" */
    it("answers no frame and leaves the parked call waiting", async () => {
      const { store, options } = build();
      const transport = LongPollTransportService.create({ ...options, pollWaitMs: 40 });
      vi.spyOn(AgentSessionService.prototype, "authenticate").mockResolvedValue({
        project: { id: attackerProjectId, slug: "attacker" },
        userId: null,
      });
      vi.spyOn(AgentSessionService.prototype, "refreshPresence").mockResolvedValue(undefined);
      await parkCall({ store, writtenBy: victimProjectId, readableBy: victimProjectId });
      await store.set(
        httpSessionKey(attackerProjectId, token),
        JSON.stringify({
          token,
          instanceId,
          projectId: attackerProjectId,
          projectSlug: "attacker",
          agentIds: [agentId],
          meta: sessionOf(attackerProjectId).meta,
        }),
        300,
      );

      const answer = await transport.poll({
        credentials: { authorization: "Bearer sk-lw-test", projectId: attackerProjectId },
        token,
        inFlightCallIds: [],
      });

      expect(answer).toEqual({ frames: [] });
      expect(await store.get(callKey(victimProjectId, callId))).not.toBeNull();
      expect(await store.get(resultKey(victimProjectId, callId))).toBeNull();
      expect(await store.zrangebyscore(pendingKey(victimProjectId, instanceId), 0)).toEqual([
        callId,
      ]);
      await transport.close();
      vi.restoreAllMocks();
    });
  });
});
