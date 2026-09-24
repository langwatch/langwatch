/** `GET /api/v1/traces/:traceId/transcript`: main's REST read of one trace's coding-agent transcript. */
import { createApiFixture } from "@langwatch/api-fixture";
import {
  bindRestMiddleware,
  canonicalErrorResponse,
  createRestRuntime,
  projectRestFacts,
} from "@langwatch/api/rest";
import {
  type TraceApi,
  TraceIdAmbiguousError,
  TraceNotFoundError,
} from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import { tracesRestCredential, tracesRest } from "../traces.rest.ts";

const transcript = {
  agent: "claude-code",
  sessionId: "session-1",
  entries: [{ kind: "prompt", text: "hello" }],
  totals: { modelCalls: 1, toolCalls: 0, tokens: 12, costUsd: 0.01 },
  subAgents: [],
};

function mount(readTraceTranscript: TraceApi["readTraceTranscript"]) {
  const stub = createApiFixture<TraceApi>({ readTraceTranscript });
  const runtime = createRestRuntime({
    identity: {
      authenticate: () => ({
        actor: { type: "user" as const, id: "user-1" },
        scope: { tier: "project" as const, id: "project-1" },
      }),
    },
  });
  const hono = runtime.mount(tracesRest.router(), {
    app: () => stub,
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

  return (traceId: string) =>
    hono.request(`http://api.test/api/v1/traces/${traceId}/transcript`, { method: "GET" });
}

describe("GET /api/v1/traces/:traceId/transcript", () => {
  describe("when the trace resolves", () => {
    /** @scenario "The REST transcript route answers one trace's transcript for the API key" */
    it("answers the transcript read with the key's own credential", async () => {
      const read = vi.fn(async () => transcript);
      const res = await mount(read)("trace-abc");

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(transcript);
      expect(read).toHaveBeenCalledWith({
        projectId: "project-1",
        traceId: "trace-abc",
        apiKeyId: "key-1",
        userId: "user-1",
      });
    });
  });

  describe("when no trace matches", () => {
    /** @scenario "The REST transcript route answers 404 for an unknown trace" */
    it("answers 404 carrying the trace_not_found code", async () => {
      const res = await mount(async () => {
        throw new TraceNotFoundError("trace-missing");
      })("trace-missing");

      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({
        code: "trace_not_found",
        meta: { traceId: "trace-missing" },
      });
    });
  });

  describe("when the prefix matches more than one trace", () => {
    /** @scenario "The REST transcript route answers 409 for an ambiguous prefix" */
    it("answers 409 naming the candidate trace ids", async () => {
      const res = await mount(async () => {
        throw new TraceIdAmbiguousError("abcdef12", ["abcdef12aa", "abcdef12bb"]);
      })("abcdef12");

      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({
        code: "trace_id_ambiguous",
        meta: { candidateTraceIds: ["abcdef12aa", "abcdef12bb"] },
      });
    });
  });
});
