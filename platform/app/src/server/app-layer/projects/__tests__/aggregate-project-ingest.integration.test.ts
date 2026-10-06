/**
 * @vitest-environment node
 *
 * ADR-144 decision 7: the aggregate owns no traces and no credential. Its
 * stored base key exists only because the column is required; the real
 * ingest routes refuse it with a 403, ClickHouse holds nothing under its
 * tenant, and the key is never shown or re-keyed.
 *
 * @see specs/governance/aggregate-project.feature
 */
import { TRPCError } from "@trpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Project } from "~/generated/prisma/client";
import { appRouter } from "~/server/api/root";
import { createInnerTRPCContext } from "~/server/api/trpc";
import { globalForApp, resetApp } from "~/server/app-layer/app";
import { createTestApp } from "~/server/app-layer/presets";
import { prisma } from "~/server/db";
import { getTestClickHouseClient } from "~/server/event-sourcing/__tests__/integration/testContainers";
import { app as authApp } from "~/server/routes/auth";
import { app as collectorApp } from "~/server/routes/collector";
import { app as otelApp } from "~/server/routes/otel";
import {
  type AggregateFixture,
  realOrganizationService,
  seedAggregateOrganization,
} from "./aggregateProjectFixture";

const callerFor = (userId: string) =>
  appRouter.createCaller(
    createInnerTRPCContext({ session: { user: { id: userId }, expires: "1" } }),
  );

const otlpTrace = () =>
  JSON.stringify({
    resourceSpans: [
      {
        resource: { attributes: [] },
        scopeSpans: [
          {
            scope: { name: "aggregate-ingest-test" },
            spans: [
              {
                traceId: "5b8efff798038103d269b633813fc60c",
                spanId: "eee19b7ec3c1b174",
                name: "should never land",
                kind: 1,
                startTimeUnixNano: `${Date.now() * 1_000_000}`,
                endTimeUnixNano: `${(Date.now() + 5) * 1_000_000}`,
              },
            ],
          },
        ],
      },
    ],
  });

describe("Feature: the aggregate project receives no traces", () => {
  let fixture: AggregateFixture;
  let aggregate: Project;

  beforeAll(async () => {
    globalForApp.__langwatch_app = createTestApp({
      organizations: realOrganizationService(prisma),
    });
    fixture = await seedAggregateOrganization(prisma, { label: "agg-ingest" });
    aggregate = await fixture.makeAggregate("company-view");
  });

  afterAll(async () => {
    await resetApp();
    await fixture?.cleanup();
  });

  /** @scenario "The aggregate project cannot receive traces" */
  describe("given an aggregate project", () => {
    describe("when a trace is sent over OTLP with the aggregate's API key", () => {
      it("is refused with a 403 that names why", async () => {
        const response = await otelApp.request("/api/otel/v1/traces", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${aggregate.apiKey}`,
          },
          body: otlpTrace(),
        });

        expect(response.status).toBe(403);
        expect(JSON.stringify(await response.json())).toContain(
          "aggregate_project_has_no_credential",
        );
      });
    });

    describe("when a trace is sent to the collector with the aggregate's API key", () => {
      it("is refused with a 403", async () => {
        const response = await collectorApp.request("/api/collector", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-auth-token": aggregate.apiKey,
          },
          body: JSON.stringify({
            trace_id: "aggregate-ingest-trace",
            spans: [
              {
                type: "span",
                span_id: "aggregate-ingest-span",
                timestamps: { started_at: Date.now(), finished_at: Date.now() },
              },
            ],
          }),
        });

        expect(response.status).toBe(403);
      });
    });

    describe("when an SDK checks the aggregate's key before sending", () => {
      it("is told the key is refused rather than good", async () => {
        const response = await authApp.request("/api/auth/validate", {
          method: "POST",
          headers: { "x-auth-token": aggregate.apiKey },
        });

        expect(response.status).toBe(403);
        const body = (await response.json()) as { error: string };
        expect(body.error).toBe("aggregate_project_has_no_credential");
      });
    });

    describe("when the aggregate's tenant is read back", () => {
      it("holds zero spans", async () => {
        const clickhouse = getTestClickHouseClient();
        if (!clickhouse)
          throw new Error("the ClickHouse test client is not up");
        const result = await clickhouse.query({
          query:
            "SELECT count() AS spans FROM stored_spans WHERE TenantId = {tenantId:String}",
          query_params: { tenantId: aggregate.id },
          format: "JSONEachRow",
        });
        const [row] = await result.json<{ spans: string }>();

        expect(Number(row?.spans)).toBe(0);
      });
    });

    describe("when an organisation admin asks to see or rotate its key", () => {
      it("is refused both, and the switcher payload carries no key for it", async () => {
        const admin = callerFor(fixture.admin.id);

        await expect(
          admin.project.getProjectAPIKey({ projectId: aggregate.id }),
        ).rejects.toBeInstanceOf(TRPCError);
        await expect(
          admin.project.regenerateApiKey({ projectId: aggregate.id }),
        ).rejects.toBeInstanceOf(TRPCError);

        const organizations = await admin.organization.getAll({});
        const listed = organizations
          .flatMap((organization) => organization.teams)
          .flatMap((team) => team.projects)
          .find((project) => project.id === aggregate.id);
        expect(listed).toBeDefined();
        expect(listed?.apiKey).toBe("");
      });
    });

    describe("when an organisation admin reads the team pages that list its projects", () => {
      it("carries no key for the aggregate, and the ordinary project keeps its own", async () => {
        const admin = callerFor(fixture.admin.id);
        const { organizationId } = fixture;

        const everyTeam = await admin.team.getTeamsWithMembers({
          organizationId,
        });
        const oneTeam = await admin.team.getTeamWithMembers({
          organizationId,
          slug: fixture.team.slug,
        });
        const withBindings = await admin.team.getTeamsWithRoleBindings({
          organizationId,
        });

        for (const projects of [
          everyTeam.flatMap((team) => team.projects),
          oneTeam.projects,
          withBindings.flatMap((team) => team.projects),
        ]) {
          const listed = projects.find((project) => project.id === aggregate.id);
          expect(listed).toBeDefined();
          expect(listed?.apiKey).toBe("");
          expect(listed?.lwqlKey).toBe("");
          expect(
            projects.find((project) => project.id === fixture.shared.id)
              ?.apiKey,
          ).toBe(fixture.shared.apiKey);
        }
      });
    });

    describe("when an ordinary project's key sends the same trace", () => {
      it("is not refused for being an aggregate", async () => {
        const response = await otelApp.request("/api/otel/v1/traces", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${fixture.shared.apiKey}`,
          },
          body: otlpTrace(),
        });

        expect(response.status).not.toBe(403);
        expect(response.status).not.toBe(401);
      });
    });
  });
});
