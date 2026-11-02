/**
 * An HTTP agent's Connector steps run as the run's setup and teardown (ADR-194): over the real
 * Connector caller and HTTP channel, against a fake code runner and a fake agent endpoint.
 * @vitest-environment node
 * @see modules/scenario/specs/scenario-run-hooks.feature
 */

import { createLogger } from "@langwatch/observability";
import type {
  ConnectorData,
  ConnectorStepData,
  HttpAgentData,
} from "@langwatch/scenario-contract";
import { describe, expect, it } from "vitest";

import type { ExecuteSyncTransport } from "../channels/execute-sync.channel.ts";
import { ConnectorHookCaller } from "../channels/http/http.connector-hook.channel.ts";
import {
  HttpSerializedHttpAgentChannel,
  type ScenarioHttp,
} from "../channels/http/http.serialized-http-agent.channel.ts";
import { SerializedAgentChannelRegistry } from "../channels/serialized-agent-channels.registry.ts";
import { CONNECTOR_STEP_NODE_ID } from "../rules/connector-step.rules.ts";
import {
  ScenarioRunHooksError,
  ScenarioRunHooksService,
} from "../services/scenario-run-hooks.service.ts";

const ACCOUNT_TOKEN = "acct-token-secret-value";
const ADMIN_KEY = "shop-admin-key-value";

const step = (overrides: Partial<ConnectorStepData> = {}): ConnectorStepData => ({
  language: "python",
  code: "def execute(input):\n    return {}\n",
  secretNames: ["SHOP_ADMIN_KEY"],
  secrets: { SHOP_ADMIN_KEY: ADMIN_KEY },
  ...overrides,
});

type StepCall = {
  kind: string;
  input: Record<string, unknown>;
  code: string;
  secrets: Record<string, string>;
};

/** What the code runner does with a step: answer outputs, raise, stop at its limit, or hang. */
type StepReply =
  | { outputs: Record<string, unknown> }
  | { raises: string }
  | "code_block_timeout"
  | "hang";

/** The execute_flow event as the fake code runner reads it. */
type StepEvent = {
  payload: {
    workflow: {
      secrets: Record<string, string>;
      nodes: { id: string; data: { parameters?: { identifier: string; value: unknown }[] } }[];
    };
    inputs: { input: Record<string, unknown> }[];
  };
};

/** A code runner that answers each step by kind and records what it was sent. */
function fakeCodeRunner(replies: Partial<Record<"setup" | "teardown", StepReply>>) {
  const calls: StepCall[] = [];
  const transport: ExecuteSyncTransport = {
    endpoint: "http://nlp.test/go/studio/execute_sync",
    post: async ({ event, signal }) => {
      const { workflow, inputs } = (event as StepEvent).payload;
      const input = inputs[0]?.input ?? {};
      const codeNode = workflow.nodes.find((node) => node.id === CONNECTOR_STEP_NODE_ID);
      const code = codeNode?.data.parameters?.find(({ identifier }) => identifier === "code");
      const kind = String(input.kind);
      calls.push({ kind, input, code: String(code?.value), secrets: workflow.secrets });
      const reply = replies[kind as "setup"] ?? { outputs: {} };
      if (reply === "hang") {
        return new Promise<never>((_, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        });
      }
      const body =
        reply === "code_block_timeout"
          ? { status: "error", error: { type: "code_block_timeout" } }
          : "raises" in reply
            ? { status: "error", error: { type: "code_runner_error", traceback: reply.raises } }
            : { status: "success", nodes: { [CONNECTOR_STEP_NODE_ID]: { outputs: reply.outputs } } };
      return { ok: true, status: 200, text: async () => JSON.stringify(body) };
    },
  };
  return { calls, transport };
}

type TurnCall = { url: string; headers: Record<string, string> };

/** The customer's agent: answers each turn, or fails echoing what it was sent. */
function fakeAgent({ fails = false }: { fails?: boolean } = {}) {
  const calls: TurnCall[] = [];
  const http: ScenarioHttp = {
    fetch: async ({ url, init }) => {
      calls.push({ url, headers: init.headers });
      const text = fails ? `bad token ${init.headers.Authorization}` : JSON.stringify({ output: "hi" });
      return {
        ok: !fails,
        status: fails ? 500 : 200,
        statusText: fails ? "Internal Server Error" : "OK",
        headers: { get: (name: string) => (name === "content-type" ? "application/json" : null) },
        json: async () => JSON.parse(text),
        text: async () => text,
      };
    },
  };
  return { calls, http };
}

const agentConfig: HttpAgentData = {
  type: "http",
  agentId: "agent_shop",
  url: "https://shop.example.com/accounts/{{ state.accountId }}/chat",
  method: "POST",
  headers: [{ key: "Authorization", value: "Bearer {{ secrets.ACCOUNT_TOKEN }}" }],
  outputPath: "$.output",
  secrets: {},
};

function runWith({
  connector,
  runner,
  agent = fakeAgent(),
  keepData,
  timeoutMs,
}: {
  connector: ConnectorData;
  runner: ReturnType<typeof fakeCodeRunner>;
  agent?: ReturnType<typeof fakeAgent>;
  keepData?: boolean;
  timeoutMs?: number;
}) {
  const hooks = ConnectorHookCaller.create({
    agentId: "agent_shop",
    connector,
    transport: runner.transport,
    projectApiKey: "sk-lw-run-key-value",
    parameters: { persona: "gold" },
    run: { scenarioRunId: "run_1", scenarioName: "Refund", batchRunId: "batch_1" },
    attemptId: "att_1",
  });
  const channel = HttpSerializedHttpAgentChannel.create({
    config: { ...agentConfig, connector },
    httpPort: agent.http,
    logger: createLogger("test"),
    connectorHooks: hooks,
  });
  const service = ScenarioRunHooksService.create({
    caller: hooks,
    declared: hooks.declared,
    ...(keepData ? { keepData } : {}),
    ...(timeoutMs ? { timeoutMs } : {}),
  });
  const turns = (success = true) => async () => {
    await channel.call(turnInput("first"));
    await channel.call(turnInput("second"));
    return { success };
  };
  return { hooks, service, turns, agent };
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

const setupReturningAccount: StepReply = {
  outputs: { state: { accountId: "acc_1" }, secrets: { ACCOUNT_TOKEN } },
};

describe("ScenarioRunHooksService over an HTTP agent's Connector", () => {
  describe("when the Connector has both steps and the run passes", () => {
    /** @scenario "An HTTP agent with a Connector runs setup, then the turns, then teardown" */
    it("runs setup in the code runner, the turns at the agent URL, then teardown with the state", async () => {
      const runner = fakeCodeRunner({ setup: setupReturningAccount, teardown: { outputs: { deleted: 1 } } });
      const { service, turns, agent } = runWith({
        connector: { setup: step(), teardown: step() },
        runner,
      });

      const { value, hooks } = await service.around(turns());

      expect(value).toEqual({ success: true });
      expect(runner.calls.map((call) => call.kind)).toEqual(["setup", "teardown"]);
      expect(runner.calls[0]?.code).toBe(step().code);
      expect(agent.calls).toHaveLength(2);
      expect(runner.calls[1]?.input.state).toEqual({ accountId: "acc_1" });
      expect(hooks.setup).toMatchObject({ status: "ok", state: { accountId: "acc_1" } });
      expect(hooks.teardown).toMatchObject({ status: "ok", returned: { deleted: 1 } });
    });

    /** @scenario "A turn template reads the state and the run-scoped secrets setup returned" */
    it("sends the state in each turn URL and the run-scoped secret in each turn header", async () => {
      const runner = fakeCodeRunner({ setup: setupReturningAccount });
      const { service, turns, agent } = runWith({ connector: { setup: step() }, runner });

      await service.around(turns());

      expect(agent.calls.map((call) => call.url)).toEqual([
        "https://shop.example.com/accounts/acc_1/chat",
        "https://shop.example.com/accounts/acc_1/chat",
      ]);
      expect(agent.calls.every((call) => call.headers.Authorization === `Bearer ${ACCOUNT_TOKEN}`)).toBe(true);
    });

    it("gives each step its kind, the run, the parameters and its own key", async () => {
      const runner = fakeCodeRunner({ setup: setupReturningAccount });
      const { service, turns } = runWith({ connector: { setup: step(), teardown: step() }, runner });

      await service.around(turns());

      const [setup, teardown] = runner.calls;
      expect(setup?.input).toEqual({
        kind: "setup",
        run: { scenarioRunId: "run_1", scenarioName: "Refund", batchRunId: "batch_1" },
        idempotencyKey: "run_1:att_1:setup",
        params: { persona: "gold" },
      });
      expect(teardown?.input).toMatchObject({ idempotencyKey: "run_1:att_1:teardown" });
      expect(teardown?.input).toHaveProperty("state");
    });

    it("gives teardown the run-scoped secrets setup returned beside its named ones", async () => {
      const runner = fakeCodeRunner({ setup: setupReturningAccount });
      const { service, turns } = runWith({ connector: { setup: step(), teardown: step() }, runner });

      await service.around(turns());

      expect(runner.calls[0]?.secrets).toEqual({ SHOP_ADMIN_KEY: ADMIN_KEY });
      expect(runner.calls[1]?.secrets).toEqual({ SHOP_ADMIN_KEY: ADMIN_KEY, ACCOUNT_TOKEN });
    });

    it("gives a step its bound rows", async () => {
      const rows = [{ persona: "gold" }, { persona: "basic" }];
      const runner = fakeCodeRunner({});
      const { service, turns } = runWith({ connector: { setup: step({ rows }) }, runner });

      await service.around(turns());

      expect(runner.calls[0]?.input.rows).toEqual(rows);
    });
  });

  describe("when setup puts a run-scoped secret in its state and a turn echoes it", () => {
    /** @scenario "Run-scoped secrets stay out of the record, the simulated user, the judge and every error" */
    it("records and shows the state with the value redacted, and redacts it from the turn error", async () => {
      const runner = fakeCodeRunner({
        setup: { outputs: { state: { accountId: "acc_1", leaked: ACCOUNT_TOKEN }, secrets: { ACCOUNT_TOKEN } } },
      });
      const { hooks, service, turns } = runWith({
        connector: { setup: step(), teardown: step() },
        runner,
        agent: fakeAgent({ fails: true }),
      });

      const failure = await service.around(turns()).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(ScenarioRunHooksError);
      const { hooks: recorded, message } = failure as ScenarioRunHooksError;
      expect(JSON.stringify(recorded)).not.toContain(ACCOUNT_TOKEN);
      expect(recorded.setup?.state).toEqual({ accountId: "acc_1", leaked: "[redacted]" });
      expect(hooks.runState).toEqual({ accountId: "acc_1", leaked: "[redacted]" });
      expect(message).toContain("[redacted]");
      expect(message).not.toContain(ACCOUNT_TOKEN);
    });
  });

  describe("when setup raises", () => {
    /** @scenario "A Connector setup that raises leaves the run not scored and still runs teardown" */
    it("plays no turn, records the traceback and still runs teardown", async () => {
      const runner = fakeCodeRunner({ setup: { raises: "Traceback: KeyError 'accounts'" } });
      const { service, turns, agent } = runWith({
        connector: { setup: step(), teardown: step() },
        runner,
      });

      const failure = (await service.around(turns()).catch((error: unknown) => error)) as ScenarioRunHooksError;

      expect(agent.calls).toHaveLength(0);
      expect(failure.hooks.setup).toMatchObject({
        status: "failed",
        error: expect.stringContaining("KeyError 'accounts'"),
      });
      expect(runner.calls.filter((call) => call.kind === "teardown")).toHaveLength(1);
    });
  });

  describe("when setup runs past its budget", () => {
    /** @scenario "A Connector setup that does not answer in time records a timeout" */
    it("records timed_out and still runs teardown", async () => {
      const runner = fakeCodeRunner({ setup: "hang" });
      const { service, turns } = runWith({
        connector: { setup: step(), teardown: step() },
        runner,
        timeoutMs: 50,
      });

      const failure = (await service.around(turns()).catch((error: unknown) => error)) as ScenarioRunHooksError;

      expect(failure.hooks.setup?.status).toBe("timed_out");
      expect(runner.calls.filter((call) => call.kind === "teardown")).toHaveLength(1);
    });

    it("records timed_out when the code runner stopped the code at its limit", async () => {
      const runner = fakeCodeRunner({ setup: "code_block_timeout" });
      const { service, turns } = runWith({ connector: { setup: step() }, runner });

      const failure = (await service.around(turns()).catch((error: unknown) => error)) as ScenarioRunHooksError;

      expect(failure.hooks.setup?.status).toBe("timed_out");
    });
  });

  describe("when a step cannot have what it names", () => {
    it("fails setup on a missing secret without calling the code runner", async () => {
      const runner = fakeCodeRunner({});
      const { service, turns } = runWith({
        connector: { setup: step({ secretNames: ["GONE_KEY"], secrets: {} }) },
        runner,
      });

      const failure = (await service.around(turns()).catch((error: unknown) => error)) as ScenarioRunHooksError;

      expect(runner.calls).toHaveLength(0);
      expect(failure.hooks.setup).toMatchObject({ status: "failed", error: expect.stringContaining("GONE_KEY") });
    });

    it("fails setup on rows over the cap without calling the code runner", async () => {
      const runner = fakeCodeRunner({});
      const rowsRefusal = "The Connector step's dataset is over the 64 KiB a step may receive.";
      const { service, turns } = runWith({ connector: { setup: step({ rowsRefusal }) }, runner });

      const failure = (await service.around(turns()).catch((error: unknown) => error)) as ScenarioRunHooksError;

      expect(runner.calls).toHaveLength(0);
      expect(failure.hooks.setup).toMatchObject({ status: "failed", error: rowsRefusal });
    });
  });

  describe("when teardown fails", () => {
    /** @scenario "A failed Connector teardown leaves the verdict unchanged" */
    it("keeps the passing verdict and records the failure", async () => {
      const runner = fakeCodeRunner({ teardown: { raises: "Traceback: boom" } });
      const { service, turns } = runWith({ connector: { teardown: step() }, runner });

      const { value, hooks } = await service.around(turns());

      expect(value).toEqual({ success: true });
      expect(hooks.teardown?.status).toBe("failed");
    });

    /** @scenario "A secret in a Connector step's error is scrubbed" */
    it("scrubs a secret the step was given out of its traceback", async () => {
      const runner = fakeCodeRunner({ teardown: { raises: `Traceback: 401 for key ${ADMIN_KEY}` } });
      const { service, turns } = runWith({ connector: { teardown: step() }, runner });

      const { hooks } = await service.around(turns());

      expect(hooks.teardown?.error).toContain("[redacted]");
      expect(hooks.teardown?.error).not.toContain(ADMIN_KEY);
    });
  });

  describe("when the run keeps its data", () => {
    /** @scenario "Rerun and keep data skips a Connector teardown" */
    it("skips the teardown step", async () => {
      const runner = fakeCodeRunner({ setup: setupReturningAccount });
      const { service, turns } = runWith({
        connector: { setup: step(), teardown: step() },
        runner,
        keepData: true,
      });

      const { hooks } = await service.around(turns());

      expect(runner.calls.map((call) => call.kind)).toEqual(["setup"]);
      expect(hooks.teardown?.status).toBe("skipped");
    });
  });
});

describe("the registry building an HTTP agent", () => {
  const registry = SerializedAgentChannelRegistry.create({
    voiceAgents: () => {
      throw new Error("no voice target in this test");
    },
  });
  const build = (connector?: ConnectorData) =>
    registry.build({
      adapterData: { ...agentConfig, ...(connector ? { connector } : {}) },
      projectApiKey: "sk-lw-run-key-value",
      nlpServiceUrl: "http://nlp.test",
    }) as HttpSerializedHttpAgentChannel;

  it("gives an agent with a Connector its steps as the run's hooks", () => {
    expect(build({ setup: step() }).connectorHooks?.declared).toEqual({ setup: true, teardown: false });
  });

  it("gives an agent without a Connector no hooks", () => {
    expect(build().connectorHooks).toBeNull();
    expect(build({}).connectorHooks).toBeNull();
  });
});
