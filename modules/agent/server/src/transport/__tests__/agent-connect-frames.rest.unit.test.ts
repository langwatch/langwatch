import type { ContentfulStatusCode } from "hono/utils/http-status";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { AgentApi } from "@langwatch/agent-contract";
/**
 * @vitest-environment node
 * `POST /api/v1/agents/connect/frames`: refused before the transport (ADR-128).
 * @see specs/agents/connected-agents.feature
 */
import {
  bindRestMiddleware,
  createRestRuntime,
  type RestCaller,
  type RestErrorHandler,
} from "@langwatch/api/rest";
import { HandledError } from "@langwatch/handled-error";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { agentConnectHeaders, createAgentConnectRest } from "../agent-connect.rest.ts";
import { agentRestErrorHandler } from "../agent.rest.ts";

const renderRefusal: RestErrorHandler = (error, c) => {
  if (HandledError.isHandled(error)) {
    return c.json(
      { error: error.code, message: error.message, ...error.meta },
      (error.httpStatus ?? 500) as ContentfulStatusCode,
    );
  }
  return c.json({ error: "internal_server_error", message: String(error) }, 500);
};

function buildApi(relayMaxPayloadMb?: number) {
  const framesSpy = vi.fn(async () => ({ accepted: 1 }));
  const app = createApiFixture<AgentApi>({ connectFrames: framesSpy });
  const runtime = createRestRuntime({
    identity: { authenticate: (): RestCaller => ({ actor: null, scope: null }) },
  } as never);
  const hono = new Hono();
  hono.route(
    "/",
    runtime.mount(createAgentConnectRest(relayMaxPayloadMb).router(), {
      app: () => app,
      onError: agentRestErrorHandler(renderRefusal),
      facts: [
        bindRestMiddleware(agentConnectHeaders, (context) => ({
          authorization: context.req.header("authorization"),
          projectId: context.req.header("x-project-id"),
          instanceToken: context.req.header("x-agent-instance-token"),
        })),
      ],
    }),
  );
  return {
    hono: { request: (path: string, init?: RequestInit) => hono.request(`http://api.test${path}`, init) },
    framesSpy,
  };
}

const headers = { "content-type": "application/json", authorization: "Bearer sk-lw-anything" };

describe("POST /connect/frames", () => {
  describe("when the body carries no ack, result or deregister frame", () => {
    /** @scenario "A frames body the endpoint does not take is refused as a protocol frame" */
    it("answers a refused frame with protocol_invalid", async () => {
      const { hono, framesSpy } = buildApi();

      const response = await hono.request("/api/v1/agents/connect/frames", {
        method: "POST",
        headers,
        body: JSON.stringify({ frames: [{ type: "not-a-real-frame" }] }),
      });

      expect(response.status).toBe(422);
      const body = (await response.json()) as { frame?: { type: string; code: string } };
      expect(body.frame).toMatchObject({ type: "refused", code: "protocol_invalid" });
      expect(framesSpy).not.toHaveBeenCalled();
    });
  });

  describe("when the body is above the frame cap", () => {
    /** @scenario "A frames body above the cap names the limit alone" */
    it("is refused with agent_payload_too_large naming the limit and no measured size", async () => {
      // A 1 mebibyte cap, well under the oversized body below.
      const { hono, framesSpy } = buildApi(1);

      const response = await hono.request("/api/v1/agents/connect/frames", {
        method: "POST",
        headers,
        body: JSON.stringify({
          frames: [
            {
              type: "result",
              protocol: 1,
              callId: "call_1",
              output: "x".repeat(2 * 1024 * 1024),
            },
          ],
        }),
      });

      expect(response.status).toBe(413);
      const body = (await response.json()) as { error: string; message: string };
      expect(body.error).toBe("agent_payload_too_large");
      // The cap stopped the read, so the message names only the limit —
      // never a measured size, which the cap never let it weigh.
      expect(body.message).toMatch(/^The result is above the limit of \d+ bytes\.$/);
      expect(framesSpy).not.toHaveBeenCalled();
    });
  });
});
