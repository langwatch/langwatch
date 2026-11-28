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
          idempotencyKey: "run_1:att_1:call:0",
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

    /** @scenario "Each call turn of a connector run gets its own idempotency key" */
    it("gives each turn's call block its own key", async () => {
      const { connector, posts } = connectorWith();

      await connector.callTurn(turn);
      await connector.callTurn(turn);

      expect(
        posts.map(({ input }) => (input as { idempotencyKey: string }).idempotencyKey),
      ).toEqual(["run_1:att_1:call:0", "run_1:att_1:call:1"]);
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

  describe("when a block returns a secret in an encoded form", () => {
    const secret = "s3cret/value+key?=";
    const forms = [
      Buffer.from(secret).toString("base64"),
      Buffer.from(secret).toString("base64url"),
      Buffer.from(secret).toString("base64").replace(/=+$/, ""),
      encodeURIComponent(secret),
    ];

    /** @scenario "A secret is redacted in its encoded forms too" */
    it("redacts every form in setup's state and in teardown's returned object, keys included", async () => {
      const echoed = {
        plain: secret,
        forms,
        nested: { [`key-${forms[0]}`]: `x${forms[3]}y` },
      };
      const { connector } = connectorWith(
        {},
        { setup: { state: echoed, secrets: { TOKEN: secret } }, teardown: echoed },
      );

      const setup = await connector.callHook({ kind: "setup", timeoutMs: 1000 });
      const teardown = await connector.callHook({ kind: "teardown", timeoutMs: 1000 });

      for (const answer of [setup, teardown]) {
        expect(answer.state).toEqual({
          plain: "[redacted]",
          forms: ["[redacted]", "[redacted]", "[redacted]", "[redacted]"],
          nested: { "key-[redacted]": "x[redacted]y" },
        });
      }
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

  describe("when setup makes data and then fails on its state", () => {
    const token = "acct-token-value";

    /** The secrets and state the teardown block was posted with. */
    function teardownPost(posts: Posted[]) {
      const post = posts.find(({ kind }) => kind === "teardown");
      return { state: post?.input.state, secrets: post?.workflow.secrets };
    }

    /** @scenario "A connector setup that fails on its state still lets teardown remove its data" */
    it("hands teardown the run-scoped secret and the scrubbed state when the state is over 64 KiB", async () => {
      const state = { accountId: "acc_1", echoed: token, blob: "x".repeat(65 * 1024) };
      const { hooks, posts } = connectorWith(
        {},
        { setup: { state, secrets: { ACCOUNT_TOKEN: token } } },
      );

      const recorded = await recordedHooks(hooks.around(async () => "turns"));

      expect(recorded.setup).toMatchObject({
        status: "failed",
        error: expect.stringContaining("64 KiB"),
      });
      expect(recorded.setup).not.toHaveProperty("state");
      expect(JSON.stringify(recorded.setup)).not.toContain(token);
      expect(teardownPost(posts).state).toMatchObject({ accountId: "acc_1", echoed: "[redacted]" });
      expect(teardownPost(posts).secrets).toEqual({
        SHOP_ADMIN_KEY: "shop-admin-key-value",
        ACCOUNT_TOKEN: token,
      });
      expect(recorded.teardown?.status).toBe("ok");
    });

    /** @scenario "A connector setup that fails on its state still lets teardown remove its data" */
    it("hands teardown the run-scoped secret and an empty state when the state is not an object", async () => {
      const { hooks, posts } = connectorWith(
        {},
        { setup: { state: "acc_1", secrets: { ACCOUNT_TOKEN: token } } },
      );

      const recorded = await recordedHooks(hooks.around(async () => "turns"));

      expect(recorded.setup).toMatchObject({
        status: "failed",
        error: expect.stringContaining("JSON object"),
      });
      expect(teardownPost(posts).state).toEqual({});
      expect(teardownPost(posts).secrets).toMatchObject({ ACCOUNT_TOKEN: token });
    });
  });

  describe("when setup returns a secret it may not return", () => {
    const value = "setup-own-value";

    /** @scenario "A connector setup secret whose name is not a secret name fails setup" */
    it("fails setup naming the name and not the value, and never hands the secret on", async () => {
      const { hooks, posts } = connectorWith(
        {},
        { setup: { state: {}, secrets: { "account-token": value } } },
      );

      const recorded = await recordedHooks(hooks.around(async () => "turns"));

      expect(recorded.setup).toMatchObject({
        status: "failed",
        error: expect.stringContaining("account-token"),
      });
      expect(recorded.setup?.error).not.toContain(value);
      const teardown = posts.find(({ kind }) => kind === "teardown");
      expect(teardown?.workflow.secrets).not.toHaveProperty("account-token");
    });

    /** @scenario "A connector setup secret cannot replace a project secret of the same name" */
    it("fails setup naming the clash and keeps the project's value for teardown", async () => {
      const { hooks, posts } = connectorWith(
        {},
        { setup: { state: {}, secrets: { SHOP_ADMIN_KEY: value } } },
      );

      const recorded = await recordedHooks(hooks.around(async () => "turns"));

      expect(recorded.setup).toMatchObject({
        status: "failed",
        error: "Setup returned secret SHOP_ADMIN_KEY, which is already a project secret.",
      });
      const teardown = posts.find(({ kind }) => kind === "teardown");
      expect(teardown?.workflow.secrets).toEqual({ SHOP_ADMIN_KEY: "shop-admin-key-value" });
    });
  });

  describe("when a block's error is longer than the error kept", () => {
    const secret = "shop-admin-key-value";

    /** @scenario "A secret across a connector error's length limit leaves none of itself in the record" */
    it("scrubs the whole traceback before cutting it", async () => {
      const traceback = `${"x".repeat(1_990)}${secret}${"y".repeat(3_000)}`;
      const channel: ConnectorBlockChannel = {
        post: async () => JSON.stringify({ status: "error", error: { type: "boom", traceback } }),
      };
      const connector = ScenarioConnectorService.create({
        config,
        channel,
        projectApiKey: "sk-lw-run-key-value",
      });

      const failure = await connector
        .callHook({ kind: "setup", timeoutMs: 1_000 })
        .catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(Error);
      const { message } = failure as Error;
      expect(message).toContain("truncated");
      expect(message).not.toContain(secret);
      expect(message).not.toContain(secret.slice(0, 8));
    });
  });

  describe("when a block's error echoes a secret that holds an address", () => {
    /** @scenario "A secret holding an address is scrubbed before addresses are redacted" */
    it("leaves no part of the secret", async () => {
      const secret = "shop-key@10.4.2.11";
      const traceback = `ConnectionError: could not reach ${secret}`;
      const channel: ConnectorBlockChannel = {
        post: async () => JSON.stringify({ status: "error", error: { type: "boom", traceback } }),
      };
      const connector = ScenarioConnectorService.create({
        config: { ...config, secrets: { SHOP_URL: secret } },
        channel,
        projectApiKey: "sk-lw-run-key-value",
      });

      const failure = await connector
        .callHook({ kind: "setup", timeoutMs: 1_000 })
        .catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(Error);
      const { message } = failure as Error;
      expect(message).toContain("[redacted]");
      expect(message).not.toContain("shop-key");
      expect(message).not.toContain("10.4.2.11");
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
     * @scenario "A refused connector records its teardown as not run"
     */
    it.each([
      "The connector names project secrets that do not exist: GONE_KEY.",
      "The connector's fixtures dataset is over the 64 KiB a block may receive.",
    ])("records setup failed with %j and never calls the code runner", async (refusal) => {
      const { connector, hooks, posts } = connectorWith({ refusal, secrets: {} });

      const recorded = await recordedHooks(hooks.around(() => connector.callTurn(turn)));

      expect(posts).toEqual([]);
      expect(recorded.setup).toMatchObject({ status: "failed", error: refusal });
      expect(recorded.teardown).toMatchObject({ status: "not_run", refused: true });
      expect(recorded.teardown?.error).not.toContain(refusal);
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
