/**
 * @vitest-environment node
 * GET /api/trace/:id?format=digest answers the rendered digest, not a pending read.
 */
import { bindRestMiddleware, createRestRuntime } from "@langwatch/api/rest";
import { describe, expect, it, vi } from "vitest";

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

function mountWithTrace() {
  const trace = {
    trace_id: "trace-1",
    project_id: "project-123",
    timestamps: { started_at: 1, inserted_at: 1 },
    metadata: {},
    spans: [],
  };
  const members: TraceLegacyRestMembers<TraceLegacySearchFields, unknown> = {
    traces: () => ({
      findTrace: vi.fn().mockResolvedValue(trace),
      readEvaluations: vi.fn().mockResolvedValue({ "trace-1": [] }),
      listTraces: vi.fn(),
      readThreadTraces: vi.fn(),
    }),
    shares: () => ({ createShare: vi.fn(), unshare: vi.fn() }),
    resolveApiKeyProtections: async () => ({}),
    searchBodySchema: {} as TraceLegacyRestMembers<
      TraceLegacySearchFields,
      unknown
    >["searchBodySchema"],
    describeValidationError: () => "invalid search body",
    formatSpansDigest: () => Promise.resolve("Spans: 1 | Total Duration: 2.00s"),
  };
  const family = runtime.mount(traceLegacyRest.router(), {
    app: () => members,
    facts: [bindRestMiddleware(tracesRestCredential, () => ({ apiKeyId: null, userId: null }))],
    onError: (_error, context) => context.json({ error: "unexpected" }, 500),
  });
  return (path: string) => family.request(path);
}

describe("given a legacy trace read asking for the digest", () => {
  describe("when the trace exists", () => {
    /** @scenario "A legacy digest read answers the rendered digest" */
    it("answers the digest text in formatted_trace", async () => {
      const response = await mountWithTrace()("/api/trace/trace-1?format=digest");

      expect(response.status).toBe(200);
      const body = (await response.json()) as { formatted_trace: unknown };
      expect(body.formatted_trace).toBe("Spans: 1 | Total Duration: 2.00s");
    });
  });
});
