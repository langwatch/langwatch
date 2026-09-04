/**
 * What `POST /api/evaluations/batch/log_results` tells a caller when the write
 * fails.
 *
 * The handler returned the caught error's own message, so a Prisma or
 * ClickHouse failure put the host, the port and the database name in front of
 * any project key. ADR-045 makes an unhandled cause generic.
 *
 * Covers @integration scenarios from
 * specs/security/feature-surface-secret-disclosure.feature.
 */
import { createAppRestSecurity, type AppRestSecurity } from "@langwatch/api/rest";
import { type ErrorHandler } from "hono";
import { describe, expect, it, vi } from "vitest";

import { createEvaluationsLegacyRestApp } from "../evaluations-legacy.api";

const DRIVER_MESSAGE =
  "Can't reach database server at `clickhouse.internal.langwatch:8443` (P1001)";

function mount(findOrCreateExperiment: () => Promise<never>) {
  const app = createEvaluationsLegacyRestApp({
    security: passThroughSecurity(),
    ports: {
      credential: async () => ({
        ok: true,
        project: { id: "project-1" },
        markUsed: vi.fn(),
      }),
      batch: {
        findOrCreateExperiment,
        experiments: () => ({
          startExperimentRun: vi.fn(),
          recordTargetResult: vi.fn(),
          recordEvaluatorResult: vi.fn(),
          completeExperimentRun: vi.fn(),
        }),
        reportEvaluation: vi.fn(),
      },
    },
  });

  return (body: unknown) =>
    app.hono.fetch(
      new Request("http://api.test/api/evaluations/batch/log_results", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
}

describe("given the legacy evaluation batch log", () => {
  describe("when the write fails with a driver diagnostic", () => {
    /** @scenario "A legacy evaluation batch failure returns no driver diagnostic" */
    it("answers a generic 500 rather than the store's own message", async () => {
      const post = mount(() => Promise.reject(new Error(DRIVER_MESSAGE)));

      const response = await post({
        experiment_slug: "my-experiment",
        run_id: "run-1",
        dataset: [],
        evaluations: [],
      });

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(JSON.stringify(body)).not.toContain("clickhouse.internal.langwatch");
      expect(body).toEqual({ error: "Internal server error" });
    });
  });
});

/** No route here is expected to throw, so a failure must be legible. */
const renderUnexpected: ErrorHandler = (error, c) => c.json({ error: String(error) }, 500);

function passThroughSecurity(): AppRestSecurity {
  const noop = async (_c: unknown, next: () => Promise<void>) => {
    await next();
  };
  const unreachable = () => {
    throw new Error("A handler-managed family must not reach the framework auth chain.");
  };
  return createAppRestSecurity({
    appContext: noop,
    requestLogger: () => noop,
    requestTracer: () => noop,
    legacyErrorHandler: renderUnexpected,
    canonicalErrorHandler: renderUnexpected,
    authenticateProject: unreachable,
    authorizeProjectPermission: unreachable,
    authorizeApiKeyCeiling: unreachable,
    authenticateOrganization: unreachable,
    authorizeOrganizationPermission: unreachable,
    authorizeRouteTeamPermission: unreachable,
    authorizeRouteProjectPermission: unreachable,
    authenticateOrganizationThrowing: noop,
    authorizeOrganizationPermissionThrowing: unreachable,
  } as never);
}
