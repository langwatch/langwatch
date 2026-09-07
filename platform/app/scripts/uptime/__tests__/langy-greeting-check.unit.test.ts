/**
 * @vitest-environment node
 *
 * scripts/uptime/langy-greeting-check.ts — the request shape, the verdict
 * table, and the drift guard on the pasted Better Stack script.
 *
 * Spec: specs/langy/langy-uptime-greeting-monitor.feature
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildGreetingRequest,
  classifyGreetingResponse,
  type FetchLike,
  formatGreetingCheckResult,
  GREETING_FAILURE_REASONS,
  LANGY_CONVERSATIONS_PATH,
  LANGY_GREETING_TEXT,
  LANGY_GREETING_WAIT_SECONDS,
  runLangyGreetingCheck,
} from "../langy-greeting-check";

const API_KEY = "sk-lw-test-key-DO-NOT-LOG";
const BASE_URL = "https://langwatch.example";

const settled = {
  conversationId: "conv_1",
  turnId: "langyturn_abc",
  status: "completed",
  error: null,
  reply: { role: "assistant", text: "Hello! How can I help?" },
};

function fetchAnswering(status: number, body: unknown): FetchLike {
  return async () => ({
    status,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  });
}

describe("buildGreetingRequest", () => {
  /** @scenario Every check starts a turn no earlier check could have started */
  it("carries whatever key the check minted, and two checks mint different ones", async () => {
    const keys: string[] = [];
    const fetch: FetchLike = async (_url, init) => {
      keys.push(JSON.parse(init.body).idempotencyKey);
      return { status: 200, text: async () => JSON.stringify(settled) };
    };
    await runLangyGreetingCheck({ baseUrl: BASE_URL, apiKey: API_KEY, fetch });
    await runLangyGreetingCheck({ baseUrl: BASE_URL, apiKey: API_KEY, fetch });
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
    expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(keys[0]).not.toContain(API_KEY);
    expect(keys[0]).not.toContain(LANGY_GREETING_TEXT);
  });

  /** @scenario The request is the plain-text turn shape with a bounded wait */
  it("posts one plain-text user message with the key in X-Auth-Token and a bounded wait", () => {
    const request = buildGreetingRequest({
      baseUrl: BASE_URL,
      apiKey: API_KEY,
      idempotencyKey: "k-1",
    });
    expect(request.method).toBe("POST");
    expect(request.url).toBe(`${BASE_URL}${LANGY_CONVERSATIONS_PATH}`);
    expect(request.headers["X-Auth-Token"]).toBe(API_KEY);
    expect(request.headers.Prefer).toBe(`wait=${LANGY_GREETING_WAIT_SECONDS}`);
    expect(LANGY_GREETING_WAIT_SECONDS).toBeLessThan(60);
    expect(JSON.parse(request.body)).toEqual({
      messages: [{ role: "user", content: LANGY_GREETING_TEXT }],
      idempotencyKey: "k-1",
    });
  });

  /** @scenario A trailing slash on the base URL does not double the path */
  it("strips trailing slashes from the base URL", () => {
    const request = buildGreetingRequest({
      baseUrl: `${BASE_URL}//`,
      apiKey: API_KEY,
      idempotencyKey: "k-1",
    });
    expect(request.url).toBe(`${BASE_URL}${LANGY_CONVERSATIONS_PATH}`);
  });
});

describe("classifyGreetingResponse", () => {
  /** @scenario A settled turn with reply text is healthy */
  it("is healthy on 200 with a non-empty reply, carrying the ids and text", () => {
    expect(classifyGreetingResponse({ status: 200, body: settled })).toEqual({
      healthy: true,
      status: 200,
      conversationId: "conv_1",
      turnId: "langyturn_abc",
      replyText: "Hello! How can I help?",
    });
  });

  /** @scenario A settled turn that failed is unhealthy even though the transport said 200 */
  it("is turn_failed on 200 with a null reply, carrying the turn's error", () => {
    const outcome = classifyGreetingResponse({
      status: 200,
      body: {
        ...settled,
        status: "failed",
        error: { code: "model_unavailable", message: "provider timed out" },
        reply: null,
      },
    });
    expect(outcome).toMatchObject({
      healthy: false,
      reason: "turn_failed",
      status: 200,
      conversationId: "conv_1",
      turnId: "langyturn_abc",
    });
    expect(outcome.healthy === false && outcome.detail).toContain(
      "provider timed out",
    );
    expect(outcome.healthy === false && outcome.detail).toContain("failed");
  });

  /** @scenario A reply with no text is not a reply */
  it.each(["", "   \n"])("is empty_reply when reply.text is %j", (text) => {
    expect(
      classifyGreetingResponse({
        status: 200,
        body: { ...settled, reply: { role: "assistant", text } },
      }),
    ).toMatchObject({ healthy: false, reason: "empty_reply", status: 200 });
  });

  /** @scenario An accepted turn that did not settle inside the wait is unhealthy */
  it("is not_settled on 202, keeping the accepted ids", () => {
    expect(
      classifyGreetingResponse({
        status: 202,
        body: { conversationId: "conv_2", turnId: "langyturn_def" },
      }),
    ).toMatchObject({
      healthy: false,
      reason: "not_settled",
      status: 202,
      conversationId: "conv_2",
      turnId: "langyturn_def",
    });
  });

  /** @scenario A dark surface is named, not mistaken for an outage of the assistant */
  it("is surface_dark on 404", () => {
    expect(classifyGreetingResponse({ status: 404, body: {} })).toMatchObject({
      healthy: false,
      reason: "surface_dark",
      status: 404,
    });
  });

  /** @scenario A refused credential is named by which gate refused it */
  it("is unauthorized on 401 and forbidden on 403", () => {
    expect(
      classifyGreetingResponse({
        status: 401,
        body: { error: { code: "credential_invalid", message: "bad key" } },
      }),
    ).toMatchObject({
      reason: "unauthorized",
      status: 401,
      detail: "credential_invalid: bad key",
    });
    expect(classifyGreetingResponse({ status: 403, body: {} })).toMatchObject({
      reason: "forbidden",
      status: 403,
    });
  });

  /** @scenario Any other status is unhealthy and keeps the status for the alert */
  it.each([
    500, 429, 502, 302,
  ])("is unexpected_status carrying %d", (status) => {
    expect(classifyGreetingResponse({ status, body: "gateway" })).toMatchObject(
      {
        healthy: false,
        reason: "unexpected_status",
        status,
      },
    );
  });

  /** @scenario A body that is not the turn envelope is unhealthy, whatever the status */
  it.each([
    null,
    "ok",
    [],
    { reply: { text: "hi" } },
    { conversationId: "c" },
  ])("is malformed_body on 200 with body %j", (body) => {
    expect(classifyGreetingResponse({ status: 200, body })).toMatchObject({
      healthy: false,
      reason: "malformed_body",
      status: 200,
    });
  });
});

describe("runLangyGreetingCheck", () => {
  /** @scenario A network failure is unhealthy with the cause, not a crash */
  it("is unreachable with the error message when fetch throws", async () => {
    const result = await runLangyGreetingCheck({
      baseUrl: BASE_URL,
      apiKey: API_KEY,
      fetch: async () => {
        throw new Error("ECONNREFUSED 10.0.0.1:443");
      },
    });
    expect(result).toMatchObject({
      healthy: false,
      reason: "unreachable",
      status: null,
      detail: "ECONNREFUSED 10.0.0.1:443",
    });
  });

  /** @scenario A non-JSON response body is unhealthy with reason malformed_body */
  it("is malformed_body when the body does not parse", async () => {
    const result = await runLangyGreetingCheck({
      baseUrl: BASE_URL,
      apiKey: API_KEY,
      fetch: fetchAnswering(200, "<html>maintenance</html>"),
    });
    expect(result).toMatchObject({
      healthy: false,
      reason: "malformed_body",
      status: 200,
    });
  });

  /** @scenario The check reports how long the turn took and which key it used */
  it("carries durationMs and the minted key", async () => {
    let tick = 1_000;
    const result = await runLangyGreetingCheck({
      baseUrl: BASE_URL,
      apiKey: API_KEY,
      fetch: fetchAnswering(200, settled),
      mintKey: () => "minted-key",
      now: () => (tick += 1_250),
    });
    expect(result).toMatchObject({
      healthy: true,
      idempotencyKey: "minted-key",
      durationMs: 1_250,
    });
  });

  /** @scenario The credential never appears in the check's output */
  it("formats a log line without the key", async () => {
    const healthy = await runLangyGreetingCheck({
      baseUrl: BASE_URL,
      apiKey: API_KEY,
      fetch: fetchAnswering(200, settled),
    });
    const refused = await runLangyGreetingCheck({
      baseUrl: BASE_URL,
      apiKey: API_KEY,
      fetch: fetchAnswering(401, {
        error: { message: `key ${API_KEY} rejected` },
      }),
    });
    for (const line of [
      formatGreetingCheckResult(healthy),
      formatGreetingCheckResult(refused),
    ]) {
      expect(line).not.toContain(API_KEY);
      expect(JSON.parse(line)).toHaveProperty("idempotencyKey");
      expect(JSON.parse(line)).toHaveProperty("durationMs");
    }
    // Upstream echoing the key in an error message is not our line to repeat.
    expect(formatGreetingCheckResult(refused)).toContain("unauthorized");
  });
});

describe("the Better Stack script", () => {
  const script = readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "langy-greeting.betterstack.js",
    ),
    "utf8",
  );

  /** @scenario The pasted script cannot drift from the check module */
  it("uses the module's greeting, wait, path, header and reason names, and a random UUID per run", () => {
    expect(script).toContain(
      `const GREETING = ${JSON.stringify(LANGY_GREETING_TEXT)};`,
    );
    expect(script).toContain(
      `const WAIT_SECONDS = ${LANGY_GREETING_WAIT_SECONDS};`,
    );
    expect(script).toContain(
      `const PATH = ${JSON.stringify(LANGY_CONVERSATIONS_PATH)};`,
    );
    expect(script).toContain('"X-Auth-Token": apiKey');
    expect(script).toContain("crypto.randomUUID()");
    for (const reason of GREETING_FAILURE_REASONS) {
      expect(script, `script must name reason ${reason}`).toContain(
        `"${reason}"`,
      );
    }
    expect(script).toContain(
      'import { expect, test } from "@playwright/test";',
    );
  });
});
