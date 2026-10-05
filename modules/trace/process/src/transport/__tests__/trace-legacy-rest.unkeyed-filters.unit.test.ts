/**
 * The deprecated `POST /api/trace/search` refuses a keyed legacy filter sent
 * without its key with the `400 { error }` sentence that family answers, rather
 * than a search that matches nothing.
 */
import { bindRestMiddleware, canonicalErrorResponse, createRestRuntime } from "@langwatch/api/rest";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  traceLegacyRest,
  type TraceLegacyRestMembers,
  type TraceLegacySearchFields,
} from "../trace-legacy.rest.ts";
import { tracesRestCredential } from "../traces.rest.ts";

type Members = TraceLegacyRestMembers<TraceLegacySearchFields, unknown>;

const searchBody = z.looseObject({
  startDate: z.number(),
  endDate: z.number(),
  llmMode: z.boolean().default(false),
});

function mount() {
  const listTraces = vi.fn();
  const members = createApiFixture<Members>({
    traces: () => ({
      findTrace: vi.fn(),
      readEvaluations: vi.fn(),
      listTraces,
      readThreadTraces: vi.fn(),
    }),
    resolveApiKeyProtections: async () => ({}),
    searchBodySchema: () => searchBody,
    describeValidationError: () => "invalid search body",
  });

  const runtime = createRestRuntime({
    identity: {
      authenticate: () => ({
        actor: { type: "user" as const, id: "user-1" },
        scope: { tier: "project" as const, id: "project-123" },
      }),
    },
  });
  const family = runtime.mount(traceLegacyRest.router(), {
    app: () => members,
    facts: [bindRestMiddleware(tracesRestCredential, () => ({ principal: null }))],
    onError: canonicalErrorResponse,
  });

  const search = (body: Record<string, unknown>) =>
    family.request("/api/trace/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  return { search, listTraces };
}

describe("POST /api/trace/search", () => {
  describe("when a keyed filter is sent as a flat list", () => {
    it("answers 400 explaining the keyed shape, without searching", async () => {
      const { search, listTraces } = mount();

      const res = await search({
        startDate: 1000,
        endDate: 5000,
        filters: { "evaluations.passed": ["false"] },
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain('{"evaluations.passed":{"<monitorId>":');
      expect(body.error).not.toContain("evaluatorVerdict");
      expect(listTraces).not.toHaveBeenCalled();
    });
  });
});
