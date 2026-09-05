/**
 * The download's own headers: the gzip framing and the filename the browser saves it under.
 * @see specs/scenarios/scenario-run-export.feature
 */
import { createAppRestSecurity, type AppRestSecurity } from "@langwatch/api/rest";
import { scenarioRunExportRequestSchema } from "@langwatch/scenario-contract";
import type { ErrorHandler, MiddlewareHandler } from "hono";
import { describe, expect, it } from "vitest";

import {
  createScenarioRunExportRestApp,
  type ScenarioRunExportPort,
  type ScenarioRunExportRestPorts,
} from "../scenario-run-export.api";

type Session = { user: { id: string } };

const session: Session = { user: { id: "user-1" } };

async function inflate(response: Response): Promise<string> {
  const stream = response.body!.pipeThrough(new DecompressionStream("gzip"));
  return await new Response(stream).text();
}

function mount(overrides: { chunks?: readonly string[]; totalCount?: number }) {
  const chunks = overrides.chunks ?? ["run_scenario_name\nRefund Request\n"];
  const totalCount = overrides.totalCount ?? chunks.length;

  const exports: ScenarioRunExportPort<{ projectId: string; mode: string }> = {
    getTotalCount: async () => totalCount,
    exportRuns: async function* () {
      for (const [index, chunk] of chunks.entries()) {
        yield { chunk, progress: { exported: index + 1, total: totalCount } };
      }
    },
  };

  const ports: ScenarioRunExportRestPorts<
    { projectId: string; mode: string },
    { projectId: string; mode: string },
    Session
  > = {
    requestSchema: scenarioRunExportRequestSchema as never,
    resolveSession: async () => session,
    probeProjectPermission: async () => true,
    recordExportRequested: async () => {},
    exports: () => exports,
    broadcast: () => ({
      broadcastToTenant: async () => undefined,
      broadcastToTenantRateLimited: async () => undefined,
    }),
    newExportId: () => "export_1",
    unauthenticatedError: () => new Error("unauthenticated"),
    forbiddenError: () => new Error("forbidden"),
  };

  const app = createScenarioRunExportRestApp({
    security: passThroughSecurity(),
    ports,
  });

  return {
    fetch: (body: unknown) =>
      app.hono.fetch(
        new Request("http://api.test/api/export/scenario-runs/download", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      ),
  };
}

function passThroughSecurity(): AppRestSecurity {
  const noop: MiddlewareHandler = async (_c, next) => next();
  const unreachable = () => {
    throw new Error("A handler-managed family must not reach the framework auth chain.");
  };
  return createAppRestSecurity({
    appContext: noop,
    requestLogger: () => noop,
    requestTracer: () => noop,
    legacyErrorHandler: renderHandled,
    canonicalErrorHandler: renderHandled,
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

const renderHandled: ErrorHandler = (error, c) => {
  const handled = error as { httpStatus?: number; code?: string; message?: string };
  if (typeof handled.httpStatus === "number") {
    return c.json(
      { code: handled.code ?? "error", message: handled.message ?? "" },
      handled.httpStatus as never,
    );
  }
  return c.json({ error: String(error) }, 500);
};

describe("given the caller is allowed to export", () => {
  /** @scenario "The download is compressed in transit" */
  it("gzips the body, and it inflates back to the CSV", async () => {
    const api = mount({ chunks: ["run_scenario_name\n", "Refund Request\n"] });

    const response = await api.fetch({ projectId: "project-1", mode: "criteria" });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Encoding")).toBe("gzip");
    expect(response.headers.get("Content-Type")).toContain("text/csv");

    const csv = await inflate(response);
    expect(csv).toContain("run_scenario_name");
    expect(csv).toContain("Refund Request");
  });

  /** @scenario "The file downloads with a descriptive name" */
  it("names the file after the project, the date and the mode", async () => {
    const api = mount({});

    const response = await api.fetch({ projectId: "my-project", mode: "criteria" });

    const today = new Date().toISOString().slice(0, 10);
    expect(response.headers.get("Content-Disposition")).toBe(
      `attachment; filename="my-project - Scenario Runs - ${today} - criteria.csv"`,
    );
    expect(response.headers.get("Access-Control-Expose-Headers")).toContain("Content-Disposition");
  });
});
