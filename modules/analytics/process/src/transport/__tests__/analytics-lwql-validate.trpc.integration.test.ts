/**
 * The validate procedure, driven through the seam a mounted procedure runs: the real validator
 * over the shipped catalogue, protections as a member's grants resolve them.
 * @vitest-environment node
 * @see modules/analytics/specs/analytics-lwql-editor.feature
 */
import type { LangWatchQLProtections } from "@langwatch/analytics-contract";
import { createApiFixture } from "@langwatch/api-fixture";
import type { TrpcProcedureFactory, TrpcRouterMount } from "@langwatch/api/trpc";
import { describe, expect, it, vi } from "vitest";

import {
  catalogueWithout,
  EVERY_CATALOGUE_PERMISSION,
} from "../../services/__tests__/lwql-catalogue-access.fixture.ts";
import { LangWatchQLValidationReportService } from "../../services/langwatch-ql-validation-report.service.ts";
import { LangWatchQLService } from "../../services/langwatch-ql.service.ts";
import { analyticsLwqlTrpcTransport, type AnalyticsLwqlApi } from "../analytics-lwql.trpc.ts";

const lwql = LangWatchQLService.create({ executor: null, database: "analytics" });

type Handler = (args: {
  input: unknown;
  actor: { type: "user"; id: string };
  scope: null;
  signal: undefined;
}) => Promise<unknown>;

/** The validate handler, mounted over an app whose protections and switch are the test's. */
function validateHandler({
  protections,
  enabled = true,
  execute = vi.fn(),
}: {
  protections: LangWatchQLProtections;
  enabled?: boolean;
  execute?: AnalyticsLwqlApi["executeLangWatchQL"];
}): Handler {
  const app = createApiFixture<AnalyticsLwqlApi>({
    isWorkbenchEnabled: async () => enabled,
    diagnoseLangWatchQL: (input) =>
      LangWatchQLValidationReportService.create({
        langWatchQL: lwql,
        protections: { resolveMemberProtections: async () => protections },
      }).report(input),
    executeLangWatchQL: execute,
  });
  const handlers: Record<string, Handler> = {};
  const runtime: TrpcProcedureFactory<object> = {
    procedure: ({ handle, procedure }) => {
      handlers[procedure.slice(procedure.lastIndexOf(".") + 1)] = (args) =>
        Promise.resolve((handle as (given: unknown) => unknown)({ ...args, app }));
      return {};
    },
    router: (record) => record,
  };
  const declaration: { router: TrpcRouterMount<AnalyticsLwqlApi, never> } =
    analyticsLwqlTrpcTransport;
  declaration.router(runtime, () => app);

  return handlers.validate!;
}

const invocation = {
  actor: { type: "user" as const, id: "user-1" },
  scope: null,
  signal: undefined,
};
const ask = (handler: Handler, sql: string) =>
  handler({ ...invocation, input: { projectId: "project-1", sql } });

describe("analytics.lwql.validate", () => {
  describe("given a member who may not read virtual_keys", () => {
    const protections: LangWatchQLProtections = {
      catalogue: catalogueWithout("virtualKeys:view"),
    };

    describe("when they validate a statement reading it", () => {
      /** @scenario "A refused table is marked by name" */
      it("answers a TABLE_NOT_ALLOWED violation at the table's position", async () => {
        const answer = await ask(
          validateHandler({ protections }),
          "SELECT * FROM analytics.virtual_keys",
        );

        expect(answer).toMatchObject({
          violations: expect.arrayContaining([
            expect.objectContaining({
              code: "TABLE_NOT_ALLOWED",
              message: expect.stringContaining("virtual_keys"),
              at: { line: 1, column: expect.any(Number) },
            }),
          ]),
        });
      });
    });

    describe("when they validate a statement reading a table they may", () => {
      it("answers no violations", async () => {
        const answer = await ask(
          validateHandler({ protections }),
          "SELECT TraceId FROM analytics.traces LIMIT 10",
        );

        expect(answer).toEqual({ violations: [] });
      });
    });
  });

  describe("given a statement the server would run", () => {
    describe("when it is validated", () => {
      /** @scenario "Validating a statement never executes it" */
      it("does not call the executor", async () => {
        const execute = vi.fn();
        await ask(
          validateHandler({ protections: { catalogue: EVERY_CATALOGUE_PERMISSION }, execute }),
          "SELECT TraceId FROM analytics.traces LIMIT 10",
        );

        expect(execute).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a statement that does not parse", () => {
    describe("when it is validated", () => {
      it("answers a PARSE_FAILED violation with its position", async () => {
        const answer = await ask(
          validateHandler({ protections: { catalogue: EVERY_CATALOGUE_PERMISSION } }),
          "SELECT FROM WHERE",
        );

        expect(answer).toMatchObject({ violations: [{ code: "PARSE_FAILED" }] });
      });
    });
  });

  describe("given the workbench is not enabled for the project", () => {
    describe("when a statement is validated", () => {
      /** @scenario "Validation is gated exactly as the schema is" */
      it("refuses with the rollout error and validates nothing", async () => {
        await expect(
          ask(
            validateHandler({
              protections: { catalogue: EVERY_CATALOGUE_PERMISSION },
              enabled: false,
            }),
            "SELECT 1",
          ),
        ).rejects.toMatchObject({ code: "lwql_not_enabled" });
      });
    });
  });
});
