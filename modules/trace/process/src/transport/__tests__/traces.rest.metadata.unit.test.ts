import {
  bindRestMiddleware,
  canonicalErrorResponse,
  createRestRuntime,
  projectRestFacts,
} from "@langwatch/api/rest";
/** `PATCH /api/v1/traces/:traceId/metadata`: main's post-creation metadata amendment. */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { TraceApi } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import { traceServer } from "../../trace.server.ts";
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
    /**
     * @scenario "PATCH /api/traces/{traceId}/metadata refuses an empty metadata object"
     * @scenario "PATCH endpoint rejects empty metadata object"
     */
    it("refuses the request and records nothing", async () => {
      const update = vi.fn(async () => undefined);
      const res = await mount(update)("trace-abc", { metadata: {} });

      expect(res.status).toBe(422);
      expect(await res.json()).toMatchObject({ code: "validation_error" });
      expect(update).not.toHaveBeenCalled();
    });
  });

  describe("when a metadata value exceeds 4KB", () => {
    /** @scenario "PATCH endpoint rejects oversized metadata values" */
    it("refuses the request and records nothing", async () => {
      const update = vi.fn(async () => undefined);
      const res = await mount(update)("trace-abc", { metadata: { note: "x".repeat(4097) } });

      expect(res.status).toBe(422);
      expect(await res.json()).toMatchObject({ code: "validation_error" });
      expect(update).not.toHaveBeenCalled();
    });
  });

  describe("when the total payload exceeds 32KB", () => {
    /** @scenario "PATCH endpoint rejects oversized metadata values" */
    it("refuses the request although each value is within 4KB", async () => {
      const update = vi.fn(async () => undefined);
      const metadata = Object.fromEntries(
        Array.from({ length: 9 }, (_, index) => [`key-${index}`, "x".repeat(4000)]),
      );
      const res = await mount(update)("trace-abc", { metadata });

      expect(res.status).toBe(422);
      expect(update).not.toHaveBeenCalled();
    });
  });
});

describe("the metadata update route as the module declares it", () => {
  /** @scenario "API documentation includes the metadata update endpoint" */
  it("is published with its permission, size limits and mechanism", () => {
    const route = tracesRest
      .router()
      .routes.find((declared) => declared.operation === "updateTraceMetadata");

    expect(traceServer.transports).toContain(tracesRest);
    expect(route?.method).toBe("patch");
    expect(route?.permission).toBe("traces:update");
    expect(route?.docs?.description).toContain("synthetic span");
    expect(route?.docs?.description).toContain("standard ingestion pipeline");
  });
});
