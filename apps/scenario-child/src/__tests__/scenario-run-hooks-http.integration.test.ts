/**
 * The child calls an HTTP agent's setup and teardown on its hooks URL around the run's turns,
 * over the real HTTP channel against a fake egress (ADR-188).
 * @vitest-environment node
 * @see modules/scenario/specs/scenario-run-hooks.feature
 */

import { createHmac } from "node:crypto";

import { fetchValidatedDestination } from "@langwatch/egress/ssrf/fenced-fetch";
import { createSsrfUrlValidator } from "@langwatch/egress/ssrf/url-validator";
import { createLogger } from "@langwatch/observability";
import type { HttpAgentData } from "@langwatch/scenario-contract";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  HttpSerializedHttpAgentChannel,
  type ScenarioHttp,
  type ScenarioHttpResponse,
} from "../channels/http/http.serialized-http-agent.channel.ts";
import {
  ScenarioRunHooksError,
  ScenarioRunHooksService,
} from "../services/scenario-run-hooks.service.ts";

// The network is the only stub: the validator and the fenced fetch are the real ones.
const network = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("undici", async (importOriginal) => ({
  ...(await importOriginal<typeof import("undici")>()),
  fetch: network.fetch,
}));

const SIGNING_SECRET = "whsec_test";

const baseConfig: HttpAgentData = {
  type: "http",
  agentId: "agent_shop",
  url: "https://shop.example.com/chat",
  method: "POST",
  headers: [],
  auth: { type: "bearer", token: "{{ secrets.HTTP_SHOP_AUTH_TOKEN }}" },
  bodyTemplate:
    '{"message": "{{ input }}", "customer": "{{ state.customerId }}", "all": {{ state }}}',
  outputPath: "$.reply",
  secrets: {
    HTTP_SHOP_AUTH_TOKEN: "tok_live",
    HTTP_SHOP_HOOKS_SIGNING_SECRET: SIGNING_SECRET,
  },
  hooksUrl: "https://shop.example.com/hooks",
  hooks: { setup: true, teardown: true },
  hooksSigningSecret: "{{ secrets.HTTP_SHOP_HOOKS_SIGNING_SECRET }}",
};

type Sent = { url: string; headers: Record<string, string>; body: string };
type Reply = { status: number; body: string } | "hang";

function response({ status, body }: { status: number; body: string }): ScenarioHttpResponse {
  return {
    ok: status < 400,
    status,
    statusText: "",
    headers: { get: (name: string) => (name === "content-type" ? "application/json" : null) },
    json: async () => JSON.parse(body),
    text: async () => body,
  };
}

/** An egress that answers the hooks URL by kind and the turn URL with a reply. */
function fakeEgress(replies: Partial<Record<"setup" | "teardown" | "turn", Reply>> = {}) {
  const sent: Sent[] = [];
  const port: ScenarioHttp = {
    fetch: async ({ url, init }) => {
      sent.push({ url, headers: init.headers, body: init.body ?? "" });
      const kind = url.includes("/hooks")
        ? (JSON.parse(init.body ?? "{}") as { kind: "setup" | "teardown" }).kind
        : "turn";
      const reply =
        replies[kind] ??
        (kind === "turn"
          ? { status: 200, body: '{"reply":"hi","state":{"customerId":"other"}}' }
          : { status: 200, body: '{"customerId":"c_1"}' });
      if (reply === "hang") {
        return new Promise<never>((_, reject) => {
          init.signal?.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          });
        });
      }
      return response(reply);
    },
  };
  return { sent, port };
}

function channelOver(egress: ReturnType<typeof fakeEgress>, config: HttpAgentData = baseConfig) {
  return HttpSerializedHttpAgentChannel.create({
    config,
    parameters: { loyalty_tier: "gold" },
    httpPort: egress.port,
    logger: createLogger("test"),
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
  channel: HttpSerializedHttpAgentChannel,
  declared = { setup: true, teardown: true },
  timeoutMs?: number,
) {
  return ScenarioRunHooksService.create({
    caller: channel,
    declared,
    ...(timeoutMs ? { timeoutMs } : {}),
  });
}

function oneTurn(channel: HttpSerializedHttpAgentChannel, success = true) {
  return async () => {
    await channel.call(turnInput("refund please"));
    return { success };
  };
}

const kindsOf = (sent: Sent[]) =>
  sent.map(({ url, body }) =>
    url.includes("/hooks") ? (JSON.parse(body) as { kind: string }).kind : "turn",
  );

describe("ScenarioRunHooksService over the HTTP channel", () => {
  describe("when the agent has a hooks URL and both hooks checked", () => {
    /** @scenario "An HTTP agent with a hooks URL calls setup, then the turns, then teardown" */
    it("calls setup and teardown on the hooks URL around the turn", async () => {
      const egress = fakeEgress();
      const channel = channelOver(egress);

      const { hooks } = await hooksFor(channel).around(oneTurn(channel));

      expect(kindsOf(egress.sent)).toEqual(["setup", "turn", "teardown"]);
      expect(egress.sent[1]?.url).toBe("https://shop.example.com/chat");
      expect(JSON.parse(egress.sent[2]?.body ?? "")).toMatchObject({
        kind: "teardown",
        state: { customerId: "c_1" },
      });
      expect(hooks.setup).toMatchObject({ status: "ok", state: { customerId: "c_1" } });
      expect(hooks.teardown).toMatchObject({ status: "ok" });
    });

    /** @scenario "An HTTP turn template reads the state setup returned" */
    it("renders the state into the turn body", async () => {
      const egress = fakeEgress();
      const channel = channelOver(egress);

      await hooksFor(channel).around(oneTurn(channel));

      expect(JSON.parse(egress.sent[1]?.body ?? "")).toEqual({
        message: "refund please",
        customer: "c_1",
        all: { customerId: "c_1" },
      });
    });

    /** @scenario "An HTTP turn cannot change the state" */
    it("keeps setup's state even when a turn answers another", async () => {
      const egress = fakeEgress();
      const channel = channelOver(egress);

      await hooksFor(channel).around(oneTurn(channel));

      expect(channel.runState).toEqual({ customerId: "c_1" });
      expect(JSON.parse(egress.sent[2]?.body ?? "").state).toEqual({ customerId: "c_1" });
    });

    /**
     * @scenario "An HTTP hook call is signed so the receiver can verify it"
     * @scenario "An HTTP hook call carries the run's idempotency key"
     * @scenario "An HTTP hook call sends the agent's headers, auth and run parameters"
     */
    it("sends the signature, the idempotency key, the agent's auth and the parameters", async () => {
      const egress = fakeEgress();
      const channel = channelOver(egress);

      await hooksFor(channel).around(oneTurn(channel));

      const setup = egress.sent[0];
      if (!setup) throw new Error("no setup call");
      const signature = setup.headers["X-LangWatch-Signature"] ?? "";
      const [, t, v1] = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(signature) ?? [];
      expect(v1).toBe(
        createHmac("sha256", SIGNING_SECRET).update(`${t}.${setup.body}`).digest("hex"),
      );
      expect(Math.abs(Date.now() / 1000 - Number(t))).toBeLessThan(300);
      expect(setup.headers["Idempotency-Key"]).toBe("run_1:setup");
      expect(egress.sent[2]?.headers["Idempotency-Key"]).toBe("run_1:teardown");
      expect(setup.headers.Authorization).toBe("Bearer tok_live");
      expect(JSON.parse(setup.body)).toEqual({
        kind: "setup",
        run: { scenarioRunId: "run_1", scenarioName: "Refund", batchRunId: "batch_1" },
        params: { loyalty_tier: "gold" },
      });
    });
  });

  describe("when setup answers HTTP 500", () => {
    /** @scenario "An HTTP setup that fails leaves the run not scored" */
    it("plays no turn, records the status and body, and still calls teardown", async () => {
      const egress = fakeEgress({ setup: { status: 500, body: "database is down" } });
      const channel = channelOver(egress);

      const error = await hooksFor(channel)
        .around(oneTurn(channel))
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ScenarioRunHooksError);
      const { hooks } = error as ScenarioRunHooksError;
      expect(kindsOf(egress.sent)).toEqual(["setup", "teardown"]);
      expect(hooks.setup).toMatchObject({ status: "failed" });
      expect(hooks.setup?.error).toContain("HTTP 500");
      expect(hooks.setup?.error).toContain("database is down");
      expect(JSON.parse(egress.sent[1]?.body ?? "")).not.toHaveProperty("state");
    });
  });

  describe("when teardown answers HTTP 500 after a passing run", () => {
    /** @scenario "An HTTP teardown that fails does not change the score" */
    it("keeps the verdict and records the error", async () => {
      const egress = fakeEgress({ teardown: { status: 500, body: "cleanup failed" } });
      const channel = channelOver(egress);

      const { value, hooks } = await hooksFor(channel).around(oneTurn(channel, true));

      expect(value).toEqual({ success: true });
      expect(hooks.teardown).toMatchObject({ status: "failed" });
      expect(hooks.teardown?.error).toContain("cleanup failed");
    });
  });

  describe("when teardown answers 204 with no body", () => {
    it("succeeds with no returned object", async () => {
      const egress = fakeEgress({ teardown: { status: 204, body: "" } });
      const channel = channelOver(egress);

      const { hooks } = await hooksFor(channel).around(oneTurn(channel));

      expect(hooks.teardown?.status).toBe("ok");
      expect(hooks.teardown?.returned).toBeUndefined();
    });
  });

  describe("when setup does not answer in time", () => {
    /** @scenario "An HTTP hook that does not answer in time times out" */
    it("records timed_out with the timeout error", async () => {
      const egress = fakeEgress({ setup: "hang" });
      const channel = channelOver(egress);

      const error = (await hooksFor(channel, undefined, 1_000)
        .around(oneTurn(channel))
        .catch((caught: unknown) => caught)) as ScenarioRunHooksError;

      expect(error.hooks.setup).toMatchObject({ status: "timed_out" });
      expect(error.hooks.setup?.error).toBe("hook timed out after 1 s");
    });
  });

  describe("when the agent has no signing secret", () => {
    /** @scenario "An HTTP hook is never sent unsigned" */
    it("sends nothing and fails naming the missing secret", async () => {
      const egress = fakeEgress();
      const { hooksSigningSecret: _unused, ...unsigned } = baseConfig;
      const channel = channelOver(egress, unsigned);

      const error = (await hooksFor(channel, { setup: true, teardown: false })
        .around(oneTurn(channel))
        .catch((caught: unknown) => caught)) as ScenarioRunHooksError;

      expect(egress.sent).toEqual([]);
      expect(error.hooks.setup?.error).toContain("signing secret is missing");
    });
  });

  describe("when only teardown is checked", () => {
    /** @scenario "An unchecked HTTP hook is not called" */
    it("calls no setup", async () => {
      const egress = fakeEgress();
      const channel = channelOver(egress);

      await hooksFor(channel, { setup: false, teardown: true }).around(oneTurn(channel));

      expect(kindsOf(egress.sent)).toEqual(["turn", "teardown"]);
      expect(JSON.parse(egress.sent[1]?.body ?? "")).not.toHaveProperty("state");
    });
  });
});

/** The worker's egress port (apps/scenario-child/src/main.ts), under the production policy. */
function workerEgress({ blockLocal }: { blockLocal: boolean }): ScenarioHttp {
  const validate = createSsrfUrlValidator({ blockLocal, allowedHosts: [] });
  return {
    fetch: async ({ url, init }) =>
      fetchValidatedDestination(await validate(url), init, { rejectUnauthorized: true }),
  };
}

describe("ScenarioRunHooksService over the worker's SSRF-fenced egress", () => {
  beforeEach(() => network.fetch.mockReset());

  async function setupError(hooksUrl: string, blockLocal = true) {
    const channel = HttpSerializedHttpAgentChannel.create({
      config: { ...baseConfig, hooksUrl },
      parameters: {},
      httpPort: workerEgress({ blockLocal }),
      logger: createLogger("test"),
      run: { scenarioRunId: "run_1", scenarioName: "Refund", batchRunId: "batch_1" },
    });
    const error = (await hooksFor(channel, { setup: true, teardown: false })
      .around(oneTurn(channel))
      .catch((caught: unknown) => caught)) as ScenarioRunHooksError;
    return error.hooks.setup;
  }

  describe("when blockLocal is on and the hooks URL is a private address", () => {
    /** @scenario "An HTTP hooks URL on a private address is refused before any request" */
    it.each(["http://10.0.0.5/hooks", "http://127.0.0.1/hooks"])(
      "refuses %s and sends nothing",
      async (hooksUrl) => {
        const setup = await setupError(hooksUrl);

        expect(network.fetch).not.toHaveBeenCalled();
        expect(setup).toMatchObject({ status: "failed" });
        expect(setup?.error).toMatch(/private|local|internal|not allowed/i);
      },
    );
  });

  describe("when the hooks URL answers a redirect", () => {
    /** @scenario "An HTTP hooks URL that answers a redirect is refused" */
    it("refuses it even to a public address", async () => {
      network.fetch.mockResolvedValue(
        new Response(null, { status: 302, headers: { location: "https://other.example.com/x" } }),
      );

      const setup = await setupError("http://93.184.216.34/hooks");

      expect(network.fetch).toHaveBeenCalledTimes(1);
      expect(setup).toMatchObject({ status: "failed" });
      expect(setup?.error).toMatch(/redirect/i);
    });
  });
});
