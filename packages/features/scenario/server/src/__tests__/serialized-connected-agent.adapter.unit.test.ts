/**
 * @vitest-environment node
 *
 * The child's own call to a connected agent over the relay route: session
 * echoing per thread, and how a refused call is named by the code the relay
 * wrote rather than by the status text beside it.
 *
 * @see specs/agents/connected-agents.feature
 */

import { describe, expect, it } from "vitest";
import type { ConnectedAgentData } from "@langwatch/scenario-contract";
import {
  ConnectedAgentCallError,
  SerializedConnectedAgentAdapter,
  type ServedInstance,
} from "../adapters/serialized-connected-agent.adapter";

const config: ConnectedAgentData = {
  type: "connected",
  agentId: "agent_connected",
  endpoint: "http://app:5560/",
  timeoutMs: 1_000,
};

type Sent = { url: string; headers: Record<string, string>; body: unknown };

function relayReply(payload: unknown, status = 200) {
  return {
    ok: status < 400,
    status,
    headers: { get: () => null },
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  };
}

function fakeRelay(replies: ReturnType<typeof relayReply>[]) {
  const sent: Sent[] = [];
  const queue = [...replies];
  return {
    sent,
    fetchImpl: async (url: string, init: { headers: Record<string, string>; body: string }) => {
      sent.push({ url, headers: init.headers, body: JSON.parse(init.body) });
      const next = queue.shift();
      if (!next) throw new Error("no reply queued");
      return next;
    },
  };
}

function adapterWith(relay: ReturnType<typeof fakeRelay>) {
  return new SerializedConnectedAgentAdapter({
    config,
    projectApiKey: "sk-lw-project",
    fetchImpl: relay.fetchImpl,
    sleep: async () => {},
  });
}

function turn(threadId: string, text: string) {
  const message = { role: "user" as const, content: text };
  return {
    threadId,
    messages: [message],
    newMessages: [message],
    requestedRole: "Agent" as never,
    scenarioState: {} as never,
    scenarioConfig: {} as never,
  };
}

const okReply = (instance: ServedInstance = { hostname: "laptop", label: null }) =>
  relayReply({ output: "hi", instance });

describe("SerializedConnectedAgentAdapter", () => {
  describe("when the agent answers a turn with a session", () => {
    /** @scenario "The session an agent returns is echoed on the next turn of the thread" */
    it("echoes it on the next turn of that thread and on no other thread", async () => {
      const relay = fakeRelay([
        relayReply({
          output: "one",
          session: { cursor: 7 },
          instance: { hostname: "laptop", label: null },
        }),
        okReply(),
        okReply(),
      ]);
      const adapter = adapterWith(relay);

      await adapter.call(turn("thread_a", "first"));
      await adapter.call(turn("thread_a", "second"));
      await adapter.call(turn("thread_b", "other"));

      expect(relay.sent[0]?.body).toMatchObject({ threadId: "thread_a" });
      expect(relay.sent[0]?.body).not.toHaveProperty("session");
      expect(relay.sent[1]?.body).toMatchObject({
        threadId: "thread_a",
        session: { cursor: 7 },
      });
      expect(relay.sent[2]?.body).not.toHaveProperty("session");
    });
  });

  describe("when the relay refuses a call with a body that carries the code and the status text", () => {
    /** @scenario "The child names a refused call by the code the relay wrote" */
    it("names the failure by the code, not by the status text beside it", async () => {
      const relay = fakeRelay([
        relayReply(
          {
            code: "agent_offline",
            message: "agent_offline",
            error: "Service Unavailable",
            meta: { agentName: "support-agent", environment: "production" },
          },
          503,
        ),
      ]);
      const adapter = adapterWith(relay);

      const failure = await adapter.call(turn("thread_a", "hello")).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(ConnectedAgentCallError);
      const typed = failure as ConnectedAgentCallError;
      expect(typed.code).toBe("agent_offline");
      expect(typed.message).not.toContain("Service Unavailable");
    });
  });
});
