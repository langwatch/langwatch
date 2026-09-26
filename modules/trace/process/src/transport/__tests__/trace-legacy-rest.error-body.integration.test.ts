/**
 * @vitest-environment node
 * Verifies error handling consistency for GET /api/trace/:id (F4 of e2e-walk).
 */
import { bindRestMiddleware, createRestRuntime } from "@langwatch/api/rest";
import { HandledError } from "@langwatch/handled-error";
import { describe, expect, it, vi } from "vitest";

import {
  traceLegacyRest,
  type TraceLegacyRestMembers,
  type TraceLegacySearchFields,
} from "../trace-legacy.rest.ts";
import { tracesRestCredential } from "../traces.rest.ts";

const project = { id: "project-123" };

const INTERNAL_MESSAGE = "TraceService requires EvaluationService for evaluation reads";

const runtime = createRestRuntime({
  identity: {
    authenticate: () => ({
      actor: { type: "user" as const, id: "user-1" },
      scope: { tier: "project" as const, id: project.id },
    }),
  },
});

function buildApi(findTrace: () => Promise<never>) {
  const members: TraceLegacyRestMembers<TraceLegacySearchFields, unknown> = {
    credential: async () => ({
      project,
      credential: { kind: "legacyProjectKey" },
      markUsed: () => undefined,
    }),
    traces: () => ({
      findTrace,
      readEvaluations: vi.fn(),
      listTraces: vi.fn(),
      readThreadTraces: vi.fn(),
    }),
    shares: () => ({ createShare: vi.fn(), unshare: vi.fn() }),
    getProtections: async () => ({}),
    resolveApiKeyProtections: async () => ({}),
    searchBodySchema: {} as TraceLegacyRestMembers<
      TraceLegacySearchFields,
      unknown
    >["searchBodySchema"],
    describeValidationError: () => "invalid search body",
    formatSpansDigest: vi.fn(),
  };

  const family = runtime.mount(traceLegacyRest.router(), {
    app: () => members,
    facts: [bindRestMiddleware(tracesRestCredential, () => ({ apiKeyId: null, userId: null }))],
    // The boundary the process installs, restated: a handled refusal answers
    // with its code, and anything else degrades to the generic unknown.
    onError: (error, context) => {
      if (HandledError.isHandled(error)) {
        const serialized = error.serialize();

        return context.json({ error: serialized.code }, serialized.httpStatus as 422);
      }

      return context.json(
        { error: "Internal Server Error", message: "An unknown error occurred" },
        500,
      );
    },
  });

  return (path: string) => family.request(path);
}

describe("given a legacy single-trace read that fails for an unanticipated reason", () => {
  describe("when the caller asks for the trace", () => {
    /** @scenario "An unanticipated legacy trace read failure answers the generic unknown" */
    it("puts no internal message, source path or stack frame in the response body", async () => {
      const failure = new Error(INTERNAL_MESSAGE);
      failure.stack = `Error: ${INTERNAL_MESSAGE}\n    at TraceService.evaluations (/Users/someone/langwatch/modules/trace/process/src/services/trace-legacy-read.service.ts:711:13)`;
      const fetchTrace = buildApi(() => Promise.reject(failure));

      const response = await fetchTrace("/api/trace/trace-1");
      const body = await response.text();

      expect(response.status).toBe(500);
      expect(body).not.toContain(INTERNAL_MESSAGE);
      expect(body).not.toContain("stack");
      expect(body).not.toContain("/Users/");
      expect(body).not.toContain(".service.ts");
    });

    /** @scenario "An unanticipated legacy trace read failure answers the generic unknown" */
    it("answers the same generic body its sibling route answers", async () => {
      const fetchTrace = buildApi(() => Promise.reject(new Error(INTERNAL_MESSAGE)));

      const response = await fetchTrace("/api/trace/trace-1");

      expect(await response.json()).toEqual({
        error: "Internal Server Error",
        message: "An unknown error occurred",
      });
    });
  });
});
