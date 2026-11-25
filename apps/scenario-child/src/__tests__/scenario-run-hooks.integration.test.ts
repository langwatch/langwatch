/**
 * The child calls a connected agent's setup and teardown around the run's turns, over the real
 * relay channel against a fake relay route (ADR-180).
 * @vitest-environment node
 * @see modules/scenario/specs/scenario-run-hooks.feature
 */

import { createLogger } from "@langwatch/observability";
import type { ConnectedAgentData } from "@langwatch/scenario-contract";
import { describe, expect, it } from "vitest";

import { HttpSerializedConnectedAgentChannel } from "../channels/http/http.serialized-connected-agent.channel.ts";
import { scenarioChildFailureLine } from "../services/scenario-child-execution.service.ts";
import {
  ScenarioRunHooksError,
  ScenarioRunHooksService,
} from "../services/scenario-run-hooks.service.ts";

const config: ConnectedAgentData = {
  type: "connected",
  agentId: "agent_shop",
  endpoint: "http://app:5560",
  timeoutMs: 1_000,
  hooks: { setup: true, teardown: true },
};

type Body = {
  kind: string;
  state: Record<string, unknown> | null;
  params: Record<string, unknown>;
  run: Record<string, unknown>;
};

type Reply = { status: number; payload: unknown } | "hang";

const instance = { hostname: "laptop", label: null };
const ok = (payload: Record<string, unknown>): Reply => ({
  status: 200,
  payload: { output: "", instance, ...payload },
});
const failed = (message: string): Reply => ({
  status: 502,
  payload: { code: "agent_call_failed", message },
});

/** A relay that answers by call kind, turn after turn, and records every body it was sent. */
function fakeRelay(replies: Partial<Record<"setup" | "teardown", Reply>> & { turns?: Reply[] }) {
  const sent: Body[] = [];
  const turns = [...(replies.turns ?? [])];
  const fetchImpl = async (_url: string, init: { body: string; signal: AbortSignal }) => {
    const body = JSON.parse(init.body) as Body;
    sent.push(body);
    const reply =
      body.kind === "turn"
        ? (turns.shift() ?? ok({ output: "hi" }))
        : (replies[body.kind as "setup"] ?? ok({}));
    if (reply === "hang") {
      return new Promise<never>((_, reject) => {
        init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
    }
    return {
      ok: reply.status < 400,
      status: reply.status,
      headers: { get: () => null },
      json: async () => reply.payload,
      text: async () => JSON.stringify(reply.payload),
    };
  };
  return { sent, fetchImpl };
}

function channelOver(relay: ReturnType<typeof fakeRelay>) {
  return HttpSerializedConnectedAgentChannel.create({
    config,
    projectApiKey: "sk-lw-project",
    parameters: { loyalty_tier: "gold" },
    logger: createLogger("test"),
    fetchImpl: relay.fetchImpl,
    sleep: async () => {},
    run: { scenarioRunId: "run_1", scenarioName: "Refund", batchRunId: "batch_1" },
  });
}

function turnInput(text: string) {
  const message = { role: "user" as const, content: text };
  return {
    threadId: "thread_1",
    messages: [message],
    newMessages: [message],
    requestedRole: "Agent" as never,
    scenarioState: {} as never,
    scenarioConfig: {} as never,
  };
}

function hooksFor(
  channel: HttpSerializedConnectedAgentChannel,
  declared = { setup: true, teardown: true },
  timeoutMs?: number,
) {
  return ScenarioRunHooksService.create({
    caller: channel,
    declared,
    ...(timeoutMs ? { timeoutMs } : {}),
  });
}

/** Two turns, as the scenario library would play them, then a verdict. */
function twoTurns(channel: HttpSerializedConnectedAgentChannel, success = true) {
  return async () => {
    await channel.call(turnInput("first"));
    await channel.call(turnInput("second"));
    return { success };
  };
}

describe("ScenarioRunHooksService over the connected channel", () => {
  describe("when the agent declares both hooks and the run passes", () => {
    /**
     * @scenario "A run calls setup, then the turns, then teardown"
     * @scenario "Teardown runs after a passing run"
     */
    it("calls setup, turn, turn, teardown in that order, teardown once", async () => {
      const relay = fakeRelay({ setup: ok({ state: { orderId: "42" } }) });
      const channel = channelOver(relay);

      const { hooks } = await hooksFor(channel).around(twoTurns(channel));

      expect(relay.sent.map((body) => body.kind)).toEqual(["setup", "turn", "turn", "teardown"]);
      expect(hooks.setup).toMatchObject({ status: "ok", state: { orderId: "42" } });
      expect(hooks.teardown).toMatchObject({ status: "ok", state: { orderId: "42" } });
    });

    it("sends the run on every call", async () => {
      const relay = fakeRelay({ setup: ok({ state: { orderId: "42" } }) });
      const channel = channelOver(relay);

      await hooksFor(channel).around(twoTurns(channel));

      for (const body of relay.sent) {
        expect(body.run).toEqual({
          scenarioRunId: "run_1",
          scenarioName: "Refund",
          batchRunId: "batch_1",
        });
      }
    });
  });

  describe("when setup returns a state", () => {
    /** @scenario "The state from setup reaches every turn and the teardown" */
    it("carries it on each turn and on teardown", async () => {
      const relay = fakeRelay({ setup: ok({ state: { orderId: "42" } }) });
      const channel = channelOver(relay);

      await hooksFor(channel).around(twoTurns(channel));

      expect(relay.sent.slice(1).map((body) => body.state)).toEqual([
        { orderId: "42" },
        { orderId: "42" },
        { orderId: "42" },
      ]);
    });
  });

  describe("when a turn returns a state update", () => {
    /** @scenario "A turn's state update replaces the state for later calls" */
    it("sends the update on the next turn and on teardown", async () => {
      const relay = fakeRelay({
        setup: ok({ state: { orderId: "42" } }),
        turns: [ok({ output: "done", state: { orderId: "43" } })],
      });
      const channel = channelOver(relay);

      const { hooks } = await hooksFor(channel).around(twoTurns(channel));

      expect(relay.sent.map((body) => body.state)).toEqual([
        null,
        { orderId: "42" },
        { orderId: "43" },
        { orderId: "43" },
      ]);
      expect(hooks.teardown?.state).toEqual({ orderId: "43" });
    });
  });

  describe("when the run's parameters are set", () => {
    /** @scenario "Hook parameters use the same value as the agent for the same run" */
    it("sends the same value to setup, the turns and teardown", async () => {
      const relay = fakeRelay({ setup: ok({ state: { orderId: "42" } }) });
      const channel = channelOver(relay);

      await hooksFor(channel).around(twoTurns(channel));

      for (const body of relay.sent) expect(body.params).toEqual({ loyalty_tier: "gold" });
    });
  });

  describe("when the judge fails the run", () => {
    /** @scenario "Teardown runs after a failing run" */
    it("still calls teardown once", async () => {
      const relay = fakeRelay({ setup: ok({ state: { orderId: "42" } }) });
      const channel = channelOver(relay);

      const { value } = await hooksFor(channel).around(twoTurns(channel, false));

      expect(value.success).toBe(false);
      expect(relay.sent.filter((body) => body.kind === "teardown")).toHaveLength(1);
    });
  });

  describe("when setup raises an error", () => {
    /** @scenario "Teardown runs after setup fails" */
    it("calls no turn, calls teardown once and fails the run with the setup error", async () => {
      const relay = fakeRelay({ setup: failed("no such customer") });
      const channel = channelOver(relay);

      const error = await hooksFor(channel)
        .around(twoTurns(channel))
        .catch((caught: unknown) => caught);

      expect(relay.sent.map((body) => body.kind)).toEqual(["setup", "teardown"]);
      expect(error).toBeInstanceOf(ScenarioRunHooksError);
      const line = scenarioChildFailureLine(error);
      expect(line.error).toContain("no such customer");
      expect(line.hooks?.setup).toMatchObject({ status: "failed" });
      expect(line.hooks?.teardown).toMatchObject({ status: "ok" });
    });
  });

  describe("when setup does not answer within its timeout", () => {
    /** @scenario "Teardown runs after setup times out" */
    it("records setup as timed out, calls no turn and calls teardown once", async () => {
      const relay = fakeRelay({ setup: "hang" });
      const channel = channelOver(relay);

      const error = await hooksFor(channel, undefined, 20)
        .around(twoTurns(channel))
        .catch((caught: unknown) => caught);

      expect(relay.sent.map((body) => body.kind)).toEqual(["setup", "teardown"]);
      const line = scenarioChildFailureLine(error);
      expect(line.hooks?.setup?.status).toBe("timed_out");
    });
  });

  describe("when the turns throw", () => {
    /** @scenario "The child runs teardown in a finally" */
    it("has called teardown by the time the result line is built", async () => {
      const relay = fakeRelay({
        setup: ok({ state: { orderId: "42" } }),
        turns: [failed("agent crashed")],
      });
      const channel = channelOver(relay);

      const error = await hooksFor(channel)
        .around(twoTurns(channel))
        .catch((caught: unknown) => caught);

      expect(relay.sent.at(-1)?.kind).toBe("teardown");
      const line = scenarioChildFailureLine(error);
      expect(line.error).toMatch(/agent crashed/);
      expect(line.hooks?.teardown).toMatchObject({ status: "ok", state: { orderId: "42" } });
    });
  });

  describe("when the agent declares teardown and not setup", () => {
    /** @scenario "An agent that declared only teardown gets only teardown" */
    it("makes no setup call and calls teardown with no state", async () => {
      const relay = fakeRelay({});
      const channel = channelOver(relay);

      const { hooks } = await hooksFor(channel, { setup: false, teardown: true }).around(
        twoTurns(channel),
      );

      expect(relay.sent.map((body) => body.kind)).toEqual(["turn", "turn", "teardown"]);
      expect(relay.sent.at(-1)?.state).toBeNull();
      expect(hooks.setup).toBeUndefined();
    });
  });

  describe("when teardown returns an object", () => {
    it("records it as the returned object, apart from the state it was given", async () => {
      const relay = fakeRelay({
        setup: ok({ state: { orderId: "42" } }),
        teardown: ok({ state: { deleted: 3 } }),
      });
      const channel = channelOver(relay);

      const { hooks } = await hooksFor(channel).around(twoTurns(channel));

      expect(hooks.teardown).toMatchObject({
        status: "ok",
        state: { orderId: "42" },
        returned: { deleted: 3 },
      });
    });
  });

  describe("when the run keeps its data", () => {
    /** @scenario "Rerun and keep data skips teardown for that rerun" */
    it("skips teardown and records it as skipped", async () => {
      const relay = fakeRelay({ setup: ok({ state: { orderId: "42" } }) });
      const channel = channelOver(relay);

      const { hooks } = await ScenarioRunHooksService.create({
        caller: channel,
        declared: { setup: true, teardown: true },
        keepData: true,
      }).around(twoTurns(channel));

      expect(relay.sent.map((body) => body.kind)).toEqual(["setup", "turn", "turn"]);
      expect(hooks.teardown).toEqual({
        status: "skipped",
        durationMs: 0,
        state: { orderId: "42" },
      });
    });
  });
});
