/**
 * The child runs an API agent's turn, setup and teardown slots through nlpgo's real code-block
 * runner (python3), with the engine's HTTP hop replaced by a transport that spawns it (ADR-180).
 * @vitest-environment node
 * @see modules/scenario/specs/scenario-run-hooks.feature
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { ApiAgentData } from "@langwatch/scenario-contract";
import { describe, expect, it } from "vitest";

import type { ExecuteSyncTransport } from "../channels/execute-sync.channel.ts";
import { HttpSerializedApiAgentChannel } from "../channels/http/http.serialized-api-agent.channel.ts";
import {
  ScenarioRunHooksError,
  ScenarioRunHooksService,
} from "../services/scenario-run-hooks.service.ts";

const RUNNER = fileURLToPath(
  new URL("../../../../services/nlpgo/app/engine/blocks/codeblock/runner.py", import.meta.url),
);

type Workflow = {
  secrets: Record<string, string>;
  nodes: { type: string; data: { parameters?: { identifier: string; value: string }[] } }[];
};
type Event = { payload: { workflow: Workflow; inputs: Record<string, string>[] } };

/** The engine's code node, reduced to what it does: run runner.py and wrap the answer. */
function runnerTransport(calls: string[]): ExecuteSyncTransport {
  return {
    endpoint: "test://runner",
    post: async ({ event }) => {
      const { workflow, inputs } = (event as Event).payload;
      const code = workflow.nodes
        .find(({ type }) => type === "code")
        ?.data.parameters?.find(({ identifier }) => identifier === "code")?.value;
      const input = inputs[0] ?? {};
      calls.push(String(input.call_kind));
      const dir = mkdtempSync(join(tmpdir(), "api-agent-"));
      try {
        const resultPath = join(dir, "result.json");
        spawnSync("python3", [RUNNER, resultPath], {
          input: JSON.stringify({
            code,
            inputs: input,
            outputs: ["output"],
            secrets: workflow.secrets,
            params: {},
          }),
        });
        const ran = JSON.parse(readFileSync(resultPath, "utf8")) as {
          outputs: Record<string, unknown>;
          error: { type: string; message: string } | null;
        };
        const body = ran.error
          ? { status: "error", error: ran.error }
          : { status: "success", result: ran.outputs };
        return { ok: true, status: 200, text: async () => JSON.stringify(body) };
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  };
}

const TURN = `
def turn(api, message, history, state):
    return f"{api.base_url}|{api.api_key}|{(state or {}).get('customerId')}|{message}|{len(history)}"
`;
const SETUP = `
def setup(api, params):
    return {"customerId": "c_" + params["plan"]}
`;
const TEARDOWN = `
def teardown(api, state, params):
    return {"deleted": state["customerId"]}
`;

const config: ApiAgentData = {
  type: "api_agent",
  agentId: "agent_api",
  baseUrl: "https://shop.example.com",
  apiKey: "{{ secrets.SHOP_KEY }}",
  turn: TURN,
  setup: SETUP,
  teardown: TEARDOWN,
  secrets: { SHOP_KEY: "key_live" },
  hooks: { setup: true, teardown: true },
};

function channelOver(calls: string[], data: ApiAgentData = config) {
  return HttpSerializedApiAgentChannel.create({
    config: data,
    projectApiKey: "lw_key",
    parameters: { plan: "gold" },
    transport: runnerTransport(calls),
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

function around(
  channel: HttpSerializedApiAgentChannel,
  declared = { setup: true, teardown: true },
) {
  let reply = "";
  return {
    run: () =>
      ScenarioRunHooksService.create({ caller: channel, declared }).around(async () => {
        reply = await channel.call(turnInput("refund please"));
        return { success: true };
      }),
    reply: () => reply,
  };
}

describe("ScenarioRunHooksService over the API agent channel", () => {
  describe("when the agent filled the setup, turn and teardown slots", () => {
    /** @scenario "An API agent calls setup, then the turns, then teardown" */
    it("runs setup, shows the state to the turn, and gives it to teardown", async () => {
      const calls: string[] = [];
      const channel = channelOver(calls);
      const run = around(channel);

      const { hooks } = await run.run();

      expect(calls).toEqual(["setup", "turn", "teardown"]);
      expect(hooks.setup).toMatchObject({ status: "ok", state: { customerId: "c_gold" } });
      expect(run.reply()).toBe("https://shop.example.com|key_live|c_gold|refund please|1");
      expect(hooks.teardown).toMatchObject({
        status: "ok",
        state: { customerId: "c_gold" },
        returned: { deleted: "c_gold" },
      });
    });
  });

  describe("when setup raises", () => {
    /** @scenario "An API agent setup that fails leaves the run not scored" */
    it("plays no turn, records the error and still runs teardown", async () => {
      const calls: string[] = [];
      const channel = channelOver(calls, {
        ...config,
        setup: 'def setup(api, params):\n    raise RuntimeError("database is down")',
      });

      const error = await around(channel)
        .run()
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ScenarioRunHooksError);
      const { hooks } = error as ScenarioRunHooksError;
      expect(calls).toEqual(["setup", "teardown"]);
      expect(hooks.setup).toMatchObject({ status: "failed" });
      expect(hooks.setup?.error).toContain("database is down");
    });
  });

  describe("when setup returns something that is not an object", () => {
    it("fails the hook naming the slot", async () => {
      const channel = channelOver([], {
        ...config,
        setup: "def setup(api, params):\n    return 5",
      });

      const error = (await around(channel, { setup: true, teardown: false })
        .run()
        .catch((caught: unknown) => caught)) as ScenarioRunHooksError;

      expect(error.hooks.setup?.error).toContain("setup slot must return a dict");
    });
  });

  describe("when the agent filled only the turn slot", () => {
    /** @scenario "An API agent with only a turn slot calls no hook" */
    it("calls no hook and gives the turn no state", async () => {
      const calls: string[] = [];
      const { setup: _s, teardown: _t, hooks: _h, ...turnOnly } = config;
      const channel = channelOver(calls, turnOnly);
      const run = around(channel, { setup: false, teardown: false });

      const { hooks } = await run.run();

      expect(calls).toEqual(["turn"]);
      expect(hooks).toEqual({});
      expect(run.reply()).toBe("https://shop.example.com|key_live|None|refund please|1");
    });
  });

  describe("when a slot fails with the api key in its message", () => {
    /** @scenario "An API agent slot's error never shows the agent's key" */
    it("never shows the key", async () => {
      const channel = channelOver([], {
        ...config,
        setup: 'def setup(api, params):\n    raise RuntimeError("refused " + api.api_key)',
      });

      const error = (await around(channel, { setup: true, teardown: false })
        .run()
        .catch((caught: unknown) => caught)) as ScenarioRunHooksError;

      expect(error.hooks.setup?.error).not.toContain("key_live");
    });
  });
});
