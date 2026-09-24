/** `PATCH /api/v1/traces/:traceId/metadata`: main's post-creation metadata amendment. */
import { createApiFixture } from "@langwatch/api-fixture";
import {
  bindRestMiddleware,
  canonicalErrorResponse,
  createRestRuntime,
  projectRestFacts,
} from "@langwatch/api/rest";
import type { TraceApi } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import { tracesRestCredential, tracesRest } from "../traces.rest.ts";

function mount(updateTraceMetadata: TraceApi["updateTraceMetadata"]) {
  const runtime = createRestRuntime({
    identity: {
      authenticate: () => ({
        actor: { type: "user" as const, id: "user-1" },
        scope: { tier: "project" as const, id: "project-1" },
      }),
    },
  });
  const hono = runtime.mount(tracesRest.router(), {
    app: () => createApiFixture<TraceApi>({ updateTraceMetadata }),
    credential: "project",
    onError: canonicalErrorResponse,
    facts: [
      bindRestMiddleware(projectRestFacts, () => ({
        projectSlug: "project-one",
        viewerUserId: null,
        actorId: "user-1",
      })),
      bindRestMiddleware(tracesRestCredential, () => ({ apiKeyId: "key-1", userId: "user-1" })),
    ],
  });

  return (traceId: string, body: unknown) =>
    hono.request(`http://api.test/api/v1/traces/${traceId}/metadata`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
}

describe("PATCH /api/v1/traces/:traceId/metadata", () => {
  describe("when the body carries metadata", () => {
    /** @scenario "PATCH /api/traces/{traceId}/metadata records the metadata and answers the trace id" */
    it("records it for the trace and answers 200 with the trace id", async () => {
      const update = vi.fn(async () => undefined);
      const res = await mount(update)("trace-abc", { metadata: { user_id: "u-1", plan: "pro" } });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ traceId: "trace-abc" });
      expect(update).toHaveBeenCalledWith({
        projectId: "project-1",
        traceId: "trace-abc",
        metadata: { user_id: "u-1", plan: "pro" },
      });
    });
  });

  describe("when the metadata has no keys", () => {
    /** @scenario "PATCH /api/traces/{traceId}/metadata refuses an empty metadata object" */
    it("refuses the request and records nothing", async () => {
      const update = vi.fn(async () => undefined);
      const res = await mount(update)("trace-abc", { metadata: {} });

      expect(res.status).toBe(422);
      expect(await res.json()).toMatchObject({ code: "validation_error" });
      expect(update).not.toHaveBeenCalled();
    });
  });
});
