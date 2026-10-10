/**
 * What a chart saved over REST (the door Langy's CLI uses) and a chart a member saves through
 * the application's own tRPC path have in common, on one shared set of repositories and the real
 * LangWatchQL validator. Only the credential chain and the workbench switch are faked.
 * @see specs/lwql/langy-authoring.feature
 * @vitest-environment node
 */

import {
  langWatchQLCallerProtections,
  type LangWatchQLProtections,
} from "@langwatch/analytics-contract";
import { VEGA_LITE_SCHEMA_URL } from "@langwatch/analytics-contract/visualization/validation";
import { createLangWatchQLService } from "@langwatch/analytics-process/testing";
import {
  bindMiddlewareContext,
  createRestRuntime,
  canonicalErrorResponse,
} from "@langwatch/api/rest";
import { createTrpcRuntime, TrpcRootDefinition } from "@langwatch/api/trpc";
import { trpcTestMembers, restTestAuthorization } from "@langwatch/test-harness/trpc-members";
import { describe, expect, it } from "vitest";

import {
  createDashboardTestAnalytics,
  createDashboardTestApp,
  FULLY_PERMITTED,
} from "../../app/__tests__/dashboard.fixture.ts";
import { MemoryDashboardRepositories } from "../../repositories/memory/memory.dashboard.repositories.ts";
import { savedWorkbenchChartRest, savedWorkbenchChartUrl } from "../saved-workbench-chart.rest.ts";
import { savedWorkbenchChartTrpcTransport } from "../saved-workbench-chart.trpc.ts";

const WITHOUT_CONTENT: LangWatchQLProtections = { ...FULLY_PERMITTED, canSeeCapturedInput: false };
const DEFINITION = {
  version: 1 as const,
  sql: "SELECT count() AS value FROM analytics.traces WHERE OccurredAt >= {since:DateTime}",
  parameters: { since: "2026-02-01 00:00:00", limit: 7, exact: true },
  vegaLiteSpec: {
    $schema: VEGA_LITE_SCHEMA_URL,
    data: { name: "query_result" },
    mark: "bar",
    encoding: { y: { field: "value", type: "quantitative" } },
  },
};

/** Both doors over one repository set, answering for the same project and protections. */
function bothDoors({
  protections = FULLY_PERMITTED,
}: { protections?: LangWatchQLProtections } = {}) {
  const repositories = MemoryDashboardRepositories.create();
  const langWatchQL = createLangWatchQLService({ executor: null, database: "analytics" });
  const app = createDashboardTestApp({
    repositories,
    dependencies: {
      analytics: createDashboardTestAnalytics({
        resolveProtections: async () => protections,
        validateLangWatchQL: (input) => langWatchQL.validate(input),
      }),
    },
  });
  const caller = {
    actor: { type: "api_key" as const, id: "key-1" },
    scope: { tier: "project" as const, id: "project-1" },
  };
  const hono = createRestRuntime({
    authorization: restTestAuthorization(),
    identity: { authenticate: () => caller, identify: () => caller },
  }).mount(savedWorkbenchChartRest.router(), {
    app: () => app,
    middlewareContext: [
      bindMiddlewareContext(langWatchQLCallerProtections, () => protections),
      bindMiddlewareContext(savedWorkbenchChartUrl, () => "https://app.langwatch.test/workbench"),
    ],
    onError: canonicalErrorResponse,
  });
  const trpc = TrpcRootDefinition.forContext<{ actor: { id: string } }>().create();
  const member = createTrpcRuntime({
    root: trpc,
    procedure: trpc.procedure,
    members: trpcTestMembers<{ actor: { id: string } }>({ permits: () => true }),
  })
    .mount(savedWorkbenchChartTrpcTransport, () => app)
    .createCaller({ actor: { id: "member-1" } });

  const saveOverRest = async ({ name, definition }: { name: string; definition: unknown }) => {
    const response = await hono.fetch(
      new Request("http://api.test/api/v1/projects/project-1/analytics/charts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, definition }),
      }),
    );

    return { status: response.status, json: (await response.json()) as { code?: string } };
  };
  const saveAsMember = ({ name, definition }: { name: string; definition: typeof DEFINITION }) =>
    member.create({ projectId: "project-1", name, definition });
  const stored = () =>
    repositories.dashboards.findAllSavedWorkbenchCharts({ projectId: "project-1" });

  return { saveOverRest, saveAsMember, stored };
}

describe("given a chart saved over REST and a chart saved by a member", () => {
  describe("when the two stored charts are compared", () => {
    /** @scenario "A chart Langy creates is indistinguishable from one a member saves by hand" */
    it("differ only in id, name and timestamps", async () => {
      const { saveOverRest, saveAsMember, stored } = bothDoors();

      const overRest = await saveOverRest({ name: "From the CLI", definition: DEFINITION });
      await saveAsMember({ name: "By hand", definition: DEFINITION });

      expect(overRest.status).toBe(201);
      const [first, second] = await stored();
      const strip = ({
        id: _id,
        name: _name,
        createdAt: _created,
        updatedAt: _updated,
        ...rest
      }: NonNullable<typeof first>) => rest;
      expect(first && second).toBeTruthy();
      expect(strip(first!)).toEqual(strip(second!));
      expect(first!.projectId).toBe("project-1");
      expect(first!.definition).toEqual(DEFINITION);
      expect(first!.id).not.toBe(second!.id);
    });
  });

  describe("when the SQL names a column the credential's protections withhold", () => {
    const gated = {
      ...DEFINITION,
      sql: "SELECT CapturedInput AS value FROM analytics.traces",
    };

    /** @scenario "SQL naming a column Langy's credentials cannot read is refused identically everywhere" */
    it("refuses over REST and through the member's save with the same validator code, saving nothing", async () => {
      const { saveOverRest, saveAsMember, stored } = bothDoors({ protections: WITHOUT_CONTENT });

      const overRest = await saveOverRest({ name: "Gated", definition: gated });
      const asMember = await saveAsMember({ name: "Gated", definition: gated }).then(
        () => {
          throw new Error("expected the member's save to be refused");
        },
        (error: { cause?: { code?: string } }) => error,
      );

      expect(overRest.json.code).toBe("lwql_not_permitted");
      expect(asMember.cause?.code).toBe("lwql_not_permitted");
      expect(await stored()).toEqual([]);
    });
  });
});
