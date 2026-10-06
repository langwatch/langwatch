/**
 * @vitest-environment node
 */
import { bindRestMiddleware, createRestRuntime } from "@langwatch/api/rest";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  traceLegacyRest,
  type TraceLegacyRestMembers,
  type TraceLegacySearchFields,
} from "../trace-legacy.rest.ts";
import { tracesRestCredential } from "../traces.rest.ts";

const runtime = createRestRuntime({
  identity: {
    authenticate: () => ({
      actor: { type: "user" as const, id: "user-1" },
      scope: { tier: "project" as const, id: "project-123" },
    }),
  },
});

/** Passes any body, so only the keyed-filter refusal stands before the search. */
const passThroughBody = z.custom<TraceLegacySearchFields>(() => true);

function mount() {
  const listTraces = vi.fn(async () => ({ groups: [], totalHits: 0, traceChecks: {} }));
  const members: TraceLegacyRestMembers<TraceLegacySearchFields, unknown> = {
    traces: () => ({
      findTrace: vi.fn(),
      readEvaluations: vi.fn(),
      listTraces,
      readThreadTraces: vi.fn(),
    }),
    shares: () => ({ createShare: vi.fn(), unshare: vi.fn() }),
    resolveApiKeyProtections: async () => ({}),
    searchBodySchema: () => passThroughBody,
    describeValidationError: () => "invalid search body",
    formatSpansDigest: vi.fn(),
  };
  const family = runtime.mount(traceLegacyRest.router(), {
    app: () => members,
    facts: [bindRestMiddleware(tracesRestCredential, () => ({ principal: null }))],
    onError: (error, context) => context.json({ error: String(error) }, 500),
  });
  const send = (body: Record<string, unknown>) =>
    family.request("/api/trace/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  return { send, listTraces };
}

describe("POST /api/trace/search", () => {
  describe("when a legacy filter that needs an evaluator key is sent as a flat list", () => {
    it("answers 400 with the sentence naming the keyed shape, rather than matching nothing", async () => {
      const { send, listTraces } = mount();
      const res = await send({
        startDate: 1000,
        endDate: 5000,
        filters: { "evaluations.passed": ["false"] },
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(Object.keys(body)).toEqual(["error"]);
      expect(body.error).toContain('"evaluations.passed" needs its key');
      expect(body.error).toContain('{"evaluations.passed":{"<monitorId>":["false"]}}');
      expect(body.error).not.toContain("evaluatorVerdict");
      expect(listTraces).not.toHaveBeenCalled();
    });
  });
});
