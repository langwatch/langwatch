/**
 * A Scenario Connector agent's blocks around a run (ADR-194): over the real connector service,
 * block channel, agent channel and hooks service, against a fake code runner.
 * @vitest-environment node
 * @see modules/scenario/specs/scenario-run-hooks.feature
 */

import type { ConnectorAgentData } from "@langwatch/scenario-contract";
import { describe, expect, it } from "vitest";

import type { ExecuteSyncTransport } from "../channels/execute-sync.channel.ts";
import { HttpConnectorBlockChannel } from "../channels/http/http.connector-block.channel.ts";
import { HttpSerializedConnectorAgentChannel } from "../channels/http/http.serialized-connector-agent.channel.ts";
import { SerializedAgentChannelRegistry } from "../channels/serialized-agent-channels.registry.ts";
import { CONNECTOR_BLOCK_NODE_ID } from "../rules/connector-block.rules.ts";
import { ScenarioConnectorService } from "../services/scenario-connector.service.ts";
import {
  ScenarioRunHooksError,
  ScenarioRunHooksService,
} from "../services/scenario-run-hooks.service.ts";

const ACCOUNT_TOKEN = "acct-token-secret-value";
const ADMIN_KEY = "shop-admin-key-value";
const block = (code = "def execute(input):\n    return {}\n") => ({
  language: "python" as const,
  code,
});

const baseConfig: ConnectorAgentData = {
  type: "connector",
  agentId: "agent_shop",
  call: block("def execute(input):\n    return {'reply': 'hi'}\n"),
  setup: block("def execute(input):\n    return {'state': {}}\n"),
  teardown: block("def execute(input):\n    return {'deleted': 1}\n"),
  secrets: { SHOP_ADMIN_KEY: ADMIN_KEY },
  timeoutMs: 60_000,
};

type BlockCall = {
  kind: string;
  input: Record<string, unknown>;
  code: string;
  secrets: Record<string, string>;
  endpoint: string;
};

/** What the code runner does with a block: answer outputs, raise, stop at its limit, or hang. */
type BlockReply =
  | { outputs: Record<string, unknown> }
  | { raises: string }
  | "code_block_timeout"
  | "hang";

type BlockEvent = {
  payload: {
    workflow: {
      secrets: Record<string, string>;
      nodes: { id: string; data: { parameters?: { identifier: string; value: unknown }[] } }[];
    };
    inputs: { input: Record<string, unknown> }[];
  };
};

function engineBody(reply: Exclude<BlockReply, "hang">) {
  if (reply === "code_block_timeout") {
    return { status: "error", error: { type: "code_block_timeout" } };
  }
  if ("raises" in reply) {
    return { status: "error", error: { type: "code_runner_error", traceback: reply.raises } };
  }
  return { status: "success", nodes: { [CONNECTOR_BLOCK_NODE_ID]: { outputs: reply.outputs } } };
}

/** How the transport itself fails, before the engine answers a block. */
type TransportFailure =
  | { status: number; body: string }
  | { rejects: Error }
  | { ok200Body: string };

const ENDPOINT = "http://nlp.test/go/studio/execute_sync";

/** A code runner that answers each block by kind, call after call, and records what it was sent. */
function fakeCodeRunner(
  replies: Partial<Record<"setup" | "teardown", BlockReply>> & { calls?: BlockReply[] },
  failure?: TransportFailure,
) {
  const calls: BlockCall[] = [];
  const callReplies = [...(replies.calls ?? [])];
  const transport: ExecuteSyncTransport = {
    endpoint: ENDPOINT,
    post: async ({ event, signal }) => {
      const { workflow, inputs } = (event as BlockEvent).payload;
      const input = inputs[0]?.input ?? {};
      const node = workflow.nodes.find(({ id }) => id === CONNECTOR_BLOCK_NODE_ID);
      const code = node?.data.parameters?.find(({ identifier }) => identifier === "code");
      const kind = String(input.kind);
      if (failure && "rejects" in failure) throw failure.rejects;
      if (failure && "status" in failure) {
        return { ok: false, status: failure.status, text: async () => failure.body };
      }
      if (failure) return { ok: true, status: 200, text: async () => failure.ok200Body };
      calls.push({
        kind,
        input,
        code: String(code?.value),
        secrets: workflow.secrets,
        endpoint: ENDPOINT,
      });
      const reply =
        kind === "call"
          ? (callReplies.shift() ?? { outputs: { reply: "hi" } })
          : (replies[kind as "setup"] ?? { outputs: {} });
      if (reply === "hang") {
        return new Promise<never>((_, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        });
      }
      const body = engineBody(reply);
      return { ok: true, status: 200, text: async () => JSON.stringify(body) };
    },
  };
  return { calls, transport };
}

function turnInput(text: string, earlier: { role: "user" | "assistant"; content: string }[] = []) {
  const message = { role: "user" as const, content: text };
  return {
    threadId: "thread_1",
    messages: [...earlier, message],
    newMessages: [message],
    requestedRole: "Agent" as never,
    scenarioState: {} as never,
    scenarioConfig: {} as never,
  };
}

function runWith({
  config = baseConfig,
  runner,
  keepData,
  timeoutMs,
}: {
  config?: ConnectorAgentData;
  runner: ReturnType<typeof fakeCodeRunner>;
  keepData?: boolean;
  timeoutMs?: number;
}) {
  const connector = ScenarioConnectorService.create({
    config,
    channel: HttpConnectorBlockChannel.create({ transport: runner.transport }),
    projectApiKey: "sk-lw-run-key-value",
    parameters: { persona: "gold" },
    run: { scenarioRunId: "run_1", scenarioName: "Refund", batchRunId: "batch_1" },
    attemptId: "att_1",
  });
  const channel = HttpSerializedConnectorAgentChannel.create({ connector });
  const service = ScenarioRunHooksService.create({
    caller: connector,
    declared: connector.declared,
    ...(keepData ? { keepData } : {}),
    ...(timeoutMs ? { timeoutMs } : {}),
  });
  const replies: string[] = [];
  const turns =
    (success = true) =>
    async () => {
      replies.push(await channel.call(turnInput("first")));
      replies.push(
        await channel.call(
          turnInput("second", [
            { role: "user", content: "first" },
            { role: "assistant", content: replies[0] ?? "" },
          ]),
        ),
      );
      return { success };
    };
  return { connector, service, turns, channel, replies };
}

const setupReturningAccount: BlockReply = {
  outputs: { state: { accountId: "acc_1" }, secrets: { ACCOUNT_TOKEN } },
};

const failureOf = (promise: Promise<unknown>) =>
  promise.catch((error: unknown) => error) as Promise<ScenarioRunHooksError>;

describe("ScenarioRunHooksService over a connector agent", () => {
  describe("when the connector has every block and the run passes", () => {
    /** @scenario "A connector agent runs setup, a call per turn, then teardown in the code runner" */
    it("runs setup, call, call, teardown in the code runner, each as its own block", async () => {
      const runner = fakeCodeRunner({
        setup: setupReturningAccount,
        teardown: { outputs: { deleted: 1 } },
      });
      const { service, turns, replies } = runWith({ runner });

      const { value, hooks } = await service.around(turns());

      expect(value).toEqual({ success: true });
      expect(runner.calls.map(({ kind }) => kind)).toEqual(["setup", "call", "call", "teardown"]);
      expect(runner.calls.map(({ code }) => code)).toEqual([
        baseConfig.setup?.code,
        baseConfig.call.code,
        baseConfig.call.code,
        baseConfig.teardown?.code,
      ]);
      expect(replies).toEqual(["hi", "hi"]);
      expect(hooks.setup).toMatchObject({ status: "ok", state: { accountId: "acc_1" } });
      expect(hooks.teardown).toMatchObject({ status: "ok", returned: { deleted: 1 } });
    });

    /** @scenario "The call block gets the message, the history, the state and the run-scoped secrets" */
    it("gives each call the message, the history, the state and the run-scoped secret", async () => {
      const runner = fakeCodeRunner({
        setup: setupReturningAccount,
        calls: [{ outputs: { reply: "Your refund is on its way." } }],
      });
      const { service, turns, replies } = runWith({ runner });

      await service.around(turns());

      const [, firstCall, secondCall] = runner.calls;
      expect(firstCall?.input).toMatchObject({
        kind: "call",
        message: "first",
        history: [{ role: "user", content: "first" }],
        state: { accountId: "acc_1" },
      });
      expect(secondCall?.input).toMatchObject({
        message: "second",
        history: [
          { role: "user", content: "first" },
          { role: "assistant", content: "Your refund is on its way." },
          { role: "user", content: "second" },
        ],
      });
      expect(firstCall?.secrets).toEqual({ SHOP_ADMIN_KEY: ADMIN_KEY, ACCOUNT_TOKEN });
      expect(replies[0]).toBe("Your refund is on its way.");
    });

    it("gives setup only the named secrets and teardown the run-scoped ones too", async () => {
      const runner = fakeCodeRunner({ setup: setupReturningAccount });
      const { service, turns } = runWith({ runner });

      await service.around(turns());

      expect(runner.calls[0]?.secrets).toEqual({ SHOP_ADMIN_KEY: ADMIN_KEY });
      expect(runner.calls.at(-1)?.secrets).toEqual({ SHOP_ADMIN_KEY: ADMIN_KEY, ACCOUNT_TOKEN });
    });
  });

  describe("when setup puts a run-scoped secret in its state and a call echoes it", () => {
    /** @scenario "Run-scoped secrets stay out of the record, the reply and every error" */
    it("records the state and answers the reply with the value redacted", async () => {
      const runner = fakeCodeRunner({
        setup: {
          outputs: {
            state: { accountId: "acc_1", leaked: ACCOUNT_TOKEN },
            secrets: { ACCOUNT_TOKEN },
          },
        },
        calls: [{ outputs: { reply: `you sent ${ACCOUNT_TOKEN}` } }],
      });
      const { connector, service, turns, replies } = runWith({ runner });

      const { hooks } = await service.around(turns());

      expect(JSON.stringify(hooks)).not.toContain(ACCOUNT_TOKEN);
      expect(hooks.setup?.state).toEqual({ accountId: "acc_1", leaked: "[redacted]" });
      expect(connector.runState).toEqual({ accountId: "acc_1", leaked: "[redacted]" });
      expect(replies[0]).toBe("you sent [redacted]");
    });
  });

  describe("when setup raises", () => {
    /** @scenario "A connector setup that raises leaves the run not scored and still runs teardown" */
    it("runs no call, records the traceback and still runs teardown", async () => {
      const runner = fakeCodeRunner({ setup: { raises: "Traceback: KeyError 'accounts'" } });
      const { service, turns } = runWith({ runner });

      const failure = await failureOf(service.around(turns()));

      expect(failure).toBeInstanceOf(ScenarioRunHooksError);
      expect(runner.calls.map(({ kind }) => kind)).toEqual(["setup", "teardown"]);
      expect(failure.hooks.setup).toMatchObject({
        status: "failed",
        error: expect.stringContaining("KeyError 'accounts'"),
      });
    });
  });

  describe("when setup runs past its budget", () => {
    /** @scenario "A connector setup that does not answer in time records a timeout" */
    it("records timed_out and still runs teardown", async () => {
      const runner = fakeCodeRunner({ setup: "hang" });
      const { service, turns } = runWith({ runner, timeoutMs: 50 });

      const failure = await failureOf(service.around(turns()));

      expect(failure.hooks.setup?.status).toBe("timed_out");
      expect(runner.calls.filter(({ kind }) => kind === "teardown")).toHaveLength(1);
    });

    it("records timed_out when the code runner stopped the block at its limit", async () => {
      const runner = fakeCodeRunner({ setup: "code_block_timeout" });
      const { service, turns } = runWith({ runner });

      const failure = await failureOf(service.around(turns()));

      expect(failure.hooks.setup?.status).toBe("timed_out");
    });
  });

  describe("when the code runner itself fails", () => {
    const setupFailureFor = async (failure: TransportFailure) => {
      const runner = fakeCodeRunner({}, failure);
      const { service, turns } = runWith({ runner });
      return (await failureOf(service.around(turns()))).hooks.setup;
    };

    /** @scenario "A connector block whose code runner fails records failed without internal addresses" */
    it("records failed on a non-2xx answer, with no internal address in the error", async () => {
      const setup = await setupFailureFor({
        status: 502,
        body: "upstream http://nlpgo:5562/go/studio down at 10.4.2.11:5561",
      });

      expect(setup).toMatchObject({ status: "failed", error: expect.stringContaining("HTTP 502") });
      expect(setup?.error).not.toContain("10.4.2.11:5561");
      expect(setup?.error).not.toContain("http://nlpgo:5562");
    });

    /** @scenario "A connector block whose code runner fails records failed without internal addresses" */
    it("records failed when the code runner cannot be reached", async () => {
      const setup = await setupFailureFor({
        rejects: Object.assign(new Error("connect ECONNREFUSED 10.4.2.11:5561"), {
          code: "ECONNREFUSED",
        }),
      });

      expect(setup).toMatchObject({
        status: "failed",
        error: expect.stringContaining("ECONNREFUSED"),
      });
      expect(setup?.error).not.toContain("10.4.2.11");
    });

    /** @scenario "A connector block whose code runner fails records failed without internal addresses" */
    it("records failed when a 200 answer is not JSON", async () => {
      const setup = await setupFailureFor({ ok200Body: "<html>gateway</html>" });

      expect(setup).toMatchObject({ status: "failed", error: expect.stringContaining("no JSON") });
    });
  });

  describe("when teardown fails", () => {
    /** @scenario "A failed connector teardown leaves the verdict unchanged" */
    it("keeps the passing verdict and records the failure", async () => {
      const runner = fakeCodeRunner({ teardown: { raises: "Traceback: boom" } });
      const { service, turns } = runWith({ runner });

      const { value, hooks } = await service.around(turns());

      expect(value).toEqual({ success: true });
      expect(hooks.teardown?.status).toBe("failed");
    });

    /** @scenario "A secret in a connector block's error is scrubbed" */
    it("scrubs a secret the block was given out of its traceback", async () => {
      const runner = fakeCodeRunner({
        teardown: { raises: `Traceback: 401 for key ${ADMIN_KEY}` },
      });
      const { service, turns } = runWith({ runner });

      const { hooks } = await service.around(turns());

      expect(hooks.teardown?.error).toContain("[redacted]");
      expect(hooks.teardown?.error).not.toContain(ADMIN_KEY);
    });
  });

  describe("when a call block raises", () => {
    /** @scenario "A call block that raises fails the turn with its scrubbed error" */
    it("fails the turn with the traceback, the secret redacted", async () => {
      const runner = fakeCodeRunner({
        setup: setupReturningAccount,
        calls: [{ raises: `Traceback: 401 for token ${ACCOUNT_TOKEN}` }],
      });
      const { service, turns } = runWith({ runner });

      const failure = await failureOf(service.around(turns()));

      expect(failure.message).toContain("Traceback: 401 for token [redacted]");
      expect(failure.message).not.toContain(ACCOUNT_TOKEN);
      expect(failure.hooks.teardown?.status).toBe("ok");
    });
  });

  describe("when the run keeps its data", () => {
    /** @scenario "Rerun and keep data skips a connector teardown" */
    it("skips the teardown block", async () => {
      const runner = fakeCodeRunner({ setup: setupReturningAccount });
      const { service, turns } = runWith({ runner, keepData: true });

      const { hooks } = await service.around(turns());

      expect(runner.calls.map(({ kind }) => kind)).toEqual(["setup", "call", "call"]);
      expect(hooks.teardown?.status).toBe("skipped");
    });
  });
});

describe("the registry building a connector agent", () => {
  const registry = SerializedAgentChannelRegistry.create({
    voiceAgents: () => {
      throw new Error("no voice target in this test");
    },
  });

  it("builds the connector channel, whose blocks are the run's hooks", () => {
    const adapter = registry.build({
      adapterData: { ...baseConfig, teardown: undefined },
      projectApiKey: "sk-lw-run-key-value",
      nlpServiceUrl: "http://nlp.test",
    });

    expect(adapter).toBeInstanceOf(HttpSerializedConnectorAgentChannel);
    expect((adapter as HttpSerializedConnectorAgentChannel).connector.declared).toEqual({
      setup: true,
      teardown: false,
    });
  });

  it("refuses to build without the run key", () => {
    expect(() =>
      registry.build({ adapterData: baseConfig, nlpServiceUrl: "http://nlp.test" }),
    ).toThrow("Connector adapter requires projectApiKey");
  });
});
