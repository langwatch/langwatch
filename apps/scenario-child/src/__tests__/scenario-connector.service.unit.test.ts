/**
 * One run of a Scenario Connector agent (ADR-194): what each block is sent, how setup's answer is
 * checked, and how a refused connector fails before the code runner is called.
 * @vitest-environment node
 * @see modules/scenario/specs/scenario-run-hooks.feature
 */

import type { ConnectorAgentData } from "@langwatch/scenario-contract";
import { describe, expect, it } from "vitest";

import type { ConnectorBlockChannel } from "../channels/connector-block.channel.ts";
import { CONNECTOR_BLOCK_NODE_ID } from "../rules/connector-block.rules.ts";
import { ScenarioConnectorService } from "../services/scenario-connector.service.ts";
import {
  ScenarioRunHooksError,
  ScenarioRunHooksService,
} from "../services/scenario-run-hooks.service.ts";

const block = { language: "python" as const, code: "def execute(input):\n    return {}\n" };
const config: ConnectorAgentData = {
  type: "connector",
  agentId: "agent_shop",
  call: block,
  setup: block,
  teardown: block,
  secrets: { SHOP_ADMIN_KEY: "shop-admin-key-value" },
  rows: [{ persona: "gold" }, { persona: "basic" }],
  timeoutMs: 60_000,
};

type Posted = Parameters<ConnectorBlockChannel["post"]>[0];

/** A channel that answers each block's outputs by kind and records every post. */
function fakeChannel(outputs: Partial<Record<"setup" | "call" | "teardown", unknown>> = {}) {
  const posts: Posted[] = [];
  const channel: ConnectorBlockChannel = {
    post: async (input) => {
      posts.push(input);
      const answer = outputs[input.kind] ?? (input.kind === "call" ? { reply: "hi" } : {});
      return JSON.stringify({
        status: "success",
        nodes: { [CONNECTOR_BLOCK_NODE_ID]: { outputs: answer } },
      });
    },
  };
  return { channel, posts };
}

function connectorWith(
  overrides: Partial<ConnectorAgentData> = {},
  outputs: Parameters<typeof fakeChannel>[0] = {},
) {
  const { channel, posts } = fakeChannel(outputs);
  const connector = ScenarioConnectorService.create({
    config: { ...config, ...overrides },
    channel,
    projectApiKey: "sk-lw-run-key-value",
    parameters: { persona: "gold" },
    run: { scenarioRunId: "run_1", scenarioName: "Refund", batchRunId: "batch_1" },
    attemptId: "att_1",
  });
  const hooks = ScenarioRunHooksService.create({ caller: connector, declared: connector.declared });
  return { connector, hooks, posts };
}

const turn = { message: "hello", history: [{ role: "user", content: "hello" }] };

/** The hooks a run that failed recorded. */
async function recordedHooks(run: Promise<unknown>) {
  const failure = await run.catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(ScenarioRunHooksError);
  return (failure as ScenarioRunHooksError).hooks;
}

describe("ScenarioConnectorService", () => {
  describe("when setup, a call and teardown run", () => {
    /** @scenario "Every connector block gets the run, the parameters, the fixture rows and its idempotency key" */
    it("sends each block the run, the parameters, the rows and its own key", async () => {
      const { connector, hooks, posts } = connectorWith(
        {},
        { setup: { state: { accountId: "acc_1" } } },
      );

      await hooks.around(() => connector.callTurn(turn));

      const run = { scenarioRunId: "run_1", scenarioName: "Refund", batchRunId: "batch_1" };
      expect(posts.map(({ input }) => input)).toEqual([
        {
          kind: "setup",
          run,
          idempotencyKey: "run_1:att_1:setup",
          params: { persona: "gold" },
          rows: config.rows,
        },
        {
          kind: "call",
          run,
          idempotencyKey: "run_1:att_1:call",
          params: { persona: "gold" },
          rows: config.rows,
          state: { accountId: "acc_1" },
          message: "hello",
          history: turn.history,
        },
        {
          kind: "teardown",
          run,
          idempotencyKey: "run_1:att_1:teardown",
          params: { persona: "gold" },
          rows: config.rows,
          state: { accountId: "acc_1" },
        },
      ]);
    });

    it("posts each block as the one code node of its workflow, the code under its budget", async () => {
      const { connector, posts } = connectorWith();

      await connector.callTurn(turn);

      const [post] = posts;
      const nodes = (post?.workflow.nodes ?? []) as {
        type: string;
        data: { parameters?: unknown };
      }[];
      const code = nodes.filter(({ type }) => type === "code");
      expect(code).toHaveLength(1);
      expect(code[0]?.data.parameters).toEqual([
        { identifier: "code", type: "code", value: block.code },
        { identifier: "timeout_ms", type: "int", value: 55_000 },
      ]);
      expect(post?.timeoutMs).toBe(60_000);
    });
  });

  describe("when setup returns a state holding a URL", () => {
    /** @scenario "The state never chooses where a connector block runs" */
    it("posts the call and teardown on the same channel, the URL only inside their input", async () => {
      const url = "https://attacker.example/collect";
      const { connector, hooks, posts } = connectorWith({}, { setup: { state: { url } } });

      await hooks.around(() => connector.callTurn(turn));

      expect(posts.map(({ kind }) => kind)).toEqual(["setup", "call", "teardown"]);
      for (const { input, workflow } of posts.slice(1)) {
        expect(input.state).toEqual({ url });
        const { nodes: _nodes, ...rest } = workflow;
        expect(JSON.stringify(rest)).not.toContain(url);
      }
    });
  });

  describe("when setup answers outside its shape", () => {
    /** @scenario "A connector setup state over 64 KiB fails setup" */
    it("fails setup naming the cap when the state is over 64 KiB", async () => {
      const { hooks } = connectorWith({}, { setup: { state: { blob: "x".repeat(65 * 1024) } } });

      const recorded = await recordedHooks(hooks.around(async () => "turns"));

      expect(recorded.setup).toMatchObject({
        status: "failed",
        error: expect.stringContaining("64 KiB"),
      });
    });

    /** @scenario "A connector setup that answers outside the state shape fails setup" */
    it("fails setup naming the { state, secrets? } shape on a bare object", async () => {
      const { hooks } = connectorWith({}, { setup: { accountId: "acc_1" } });

      const recorded = await recordedHooks(hooks.around(async () => "turns"));

      expect(recorded.setup).toMatchObject({
        status: "failed",
        error: expect.stringContaining("{ state, secrets? }"),
      });
    });
  });

  describe("when the call block returns no reply", () => {
    it("fails the turn naming the { reply } shape", async () => {
      const { connector } = connectorWith({}, { call: { answer: "hi" } });

      await expect(connector.callTurn(turn)).rejects.toThrow("{ reply }");
    });
  });

  describe("when the connector carries a refusal", () => {
    /**
     * @scenario "A connector agent that names a missing secret fails setup before any block runs"
     * @scenario "A connector agent whose fixtures are over 64 KiB fails setup before any block runs"
     */
    it.each([
      "The connector names project secrets that do not exist: GONE_KEY.",
      "The connector's fixtures dataset is over the 64 KiB a block may receive.",
    ])("records setup failed with %j and never calls the code runner", async (refusal) => {
      const { connector, hooks, posts } = connectorWith({ refusal, secrets: {} });

      const recorded = await recordedHooks(hooks.around(() => connector.callTurn(turn)));

      expect(posts).toEqual([]);
      expect(recorded.setup).toMatchObject({ status: "failed", error: refusal });
      expect(recorded.teardown).toMatchObject({ status: "failed", error: refusal });
    });

    /** @scenario "Without the release flag a connector agent runs no block and is not scored" */
    it("records the release refusal as a failed setup even without a setup block", async () => {
      const refusal = "Connector steps are not released for this project yet.";
      const { connector, hooks, posts } = connectorWith({
        refusal,
        secrets: {},
        setup: undefined,
        teardown: undefined,
      });

      expect(connector.declared).toEqual({ setup: true, teardown: false });
      const recorded = await recordedHooks(hooks.around(() => connector.callTurn(turn)));

      expect(posts).toEqual([]);
      expect(recorded.setup).toMatchObject({ status: "failed", error: refusal });
      await expect(connector.callTurn(turn)).rejects.toThrow(refusal);
    });
  });
});
