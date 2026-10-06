import type { AgentApi } from "@langwatch/agent-contract";
import type { RestCaller } from "@langwatch/api/hosting";
/**
 * @vitest-environment node
 * A connect answer that breaks its schema is kept, and logged without its content.
 * @see specs/agents/connected-agents.feature
 */
import { bindRestMiddleware, createRestRuntime, canonicalErrorResponse } from "@langwatch/api/rest";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

const log = vi.hoisted(() => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }));
vi.mock("@langwatch/observability", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createLogger: () => log,
}));

import { agentConnectHeaders, createAgentConnectRest } from "../agent-connect.rest.ts";

const SECRET_MARKER = "SECRETMARK-9f3a";

function buildApi(connectFrames: AgentApi["connectFrames"]) {
  const app = createApiFixture<AgentApi>({ connectFrames });
  const runtime = createRestRuntime({
    identity: { authenticate: (): RestCaller => ({ actor: null, scope: null }) },
  } as never);
  const hono = new Hono();
  hono.route(
    "/",
    runtime.mount(createAgentConnectRest().router(), {
      app: () => app,
      onError: canonicalErrorResponse,
      facts: [
        bindRestMiddleware(agentConnectHeaders, (context) => ({
          authorization: context.req.header("authorization"),
          projectId: context.req.header("x-project-id"),
          instanceToken: context.req.header("x-agent-instance-token"),
        })),
      ],
    }),
  );
  return hono;
}

const request = {
  method: "POST",
  headers: {
    "content-type": "application/json",
    authorization: "Bearer sk-lw-anything",
    "x-agent-instance-token": "ait_test",
  },
  body: JSON.stringify({
    frames: [{ type: "ack", protocol: 1, callId: "call_1" }],
  }),
} as const;

describe("a connect answer that breaks its schema", () => {
  /** @scenario "A malformed protocol output preserves the response without logging its content" */
  it("is sent as the App produced it and logged by endpoint and failure alone", async () => {
    log.error.mockClear();
    const hono = buildApi((async () => ({ accepted: SECRET_MARKER })) as never);

    const response = await hono.request("http://api.test/api/v1/agents/connect/frames", request);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ accepted: SECRET_MARKER });
    expect(log.error).toHaveBeenCalledTimes(1);
    const [fields, message] = log.error.mock.calls[0] as [Record<string, unknown>, string];
    expect(fields).toMatchObject({
      endpoint: "POST /connect/frames",
      issues: [{ path: "accepted", code: "invalid_type" }],
    });
    expect(JSON.stringify(log.error.mock.calls)).not.toContain(SECRET_MARKER);
    expect(message).not.toContain(SECRET_MARKER);
  });

  describe("when the answer keeps its schema", () => {
    it("logs nothing", async () => {
      log.error.mockClear();
      const hono = buildApi((async () => ({ accepted: 1 })) as never);

      const response = await hono.request("http://api.test/api/v1/agents/connect/frames", request);

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ accepted: 1 });
      expect(log.error).not.toHaveBeenCalled();
    });
  });
});
