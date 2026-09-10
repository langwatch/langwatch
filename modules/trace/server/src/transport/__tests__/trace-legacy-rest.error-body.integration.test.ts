/**
 * @vitest-environment node
 * What `GET /api/trace/:id` answers a customer when the read fails for a reason
 * nobody anticipated. The family used to render that failure itself (internal
 * message, absolute source paths, stack frames straight into the body) while its
 * sibling `GET /api/traces/:traceId`, on the same failure in the same process,
 * degraded to the generic unknown. Finding F4 of
 * `dev/docs/plans/e2e-walk-2026-09-04.md`. Run over the real declaration and the
 * REST runtime that mounts it.
 */
import { createRestRuntime } from "@langwatch/api/rest";
import { HandledError } from "@langwatch/handled-error";
import { describe, expect, it, vi } from "vitest";

import {
  traceLegacyRest,
  type TraceLegacyRestMembers,
  type TraceLegacySearchFields,
} from "../trace-legacy.rest.ts";

const project = { id: "project-123" };

const INTERNAL_MESSAGE = "TraceService requires EvaluationService for evaluation reads";

const runtime = createRestRuntime({
  identity: {
    authenticate: () => {
      throw new Error("The deprecated trace family resolves its own credential.");
    },
  },
});

function buildApi(readTrace: () => Promise<never>) {
  const members: TraceLegacyRestMembers<TraceLegacySearchFields, unknown> = {
    credential: async () => ({
      ok: true,
      project,
      credential: { kind: "legacyProjectKey" },
      markUsed: () => undefined,
    }),
    traces: () => ({
      readTrace,
      readEvaluations: vi.fn(),
      listTraces: vi.fn(),
      readThreadTraces: vi.fn(),
    }),
    shares: () => ({ createShare: vi.fn(), unshare: vi.fn() }),
    getProtections: async () => ({}),
    searchBodySchema: {} as TraceLegacyRestMembers<
      TraceLegacySearchFields,
      unknown
    >["searchBodySchema"],
    describeValidationError: () => "invalid search body",
  };

  const family = runtime.mount(traceLegacyRest.router(), {
    app: () => members,
    credential: "public",
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
      failure.stack = `Error: ${INTERNAL_MESSAGE}\n    at TraceService.evaluations (/Users/someone/langwatch/modules/trace/server/src/services/trace-legacy-read.service.ts:711:13)`;
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
