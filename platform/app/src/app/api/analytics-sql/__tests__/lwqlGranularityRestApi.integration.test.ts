/**
 * The LangWatchQL query endpoint's granularity budget refusal, driven through
 * the real HTTP app — auth middleware, RBAC, the feature switch, the validator,
 * the service — against a real Postgres.
 *
 * No ClickHouse, for the same reason the saved-charts REST suite needs none:
 * the refusal under test fires inside the service before any executor is
 * consulted, so an unprovisioned deployment answers it identically. The
 * fitting-step control below leans on that on purpose — past the budget gate
 * this deployment's honest answer is `lwql_unavailable`, which proves the
 * refusal was about the bucket arithmetic and not about the door.
 *
 * The family publishes the canonical error envelope, so the refusal is read at
 * `body.error.code` with its structured detail at `body.error.meta` — by code,
 * never by message prose.
 *
 * @see specs/analytics/lwql-workbench.feature
 * @see ~/server/analytics/lwql/resolveTimeWindow.ts — the budget contract
 */

import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { projectFactory } from "~/factories/project.factory";
import type { Organization, Project, Team } from "~/generated/prisma/client";
import { globalForApp, resetApp } from "~/server/app-layer/app";
import { createTestApp } from "~/server/app-layer/presets";
import {
  type PlanProvider,
  PlanProviderService,
} from "~/server/app-layer/subscription/plan-provider";
import { prisma } from "~/server/db";
import { FREE_PLAN } from "../../../../../ee/licensing/constants";
import { app } from "../[[...route]]/app";

type Body = Record<string, any>;

/** Declares the granularity parameter alongside both reserved period bounds. */
const GRANULARITY_SQL =
  "SELECT toStartOfInterval(OccurredAt, INTERVAL {period_granularity_seconds:UInt32} SECOND) AS bucket, " +
  "count() AS value FROM analytics.traces " +
  "WHERE OccurredAt >= {period_start:DateTime} AND OccurredAt < {period_end:DateTime} " +
  "GROUP BY bucket ORDER BY bucket";

/** Seven days, in seconds — the window every request below reports over. */
const WEEK_SECONDS = 7 * 24 * 3600;

describe("given the LangWatchQL REST query endpoint and the granularity budget", () => {
  const ns = nanoid(8);

  let organization: Organization;
  let team: Team;
  let project: Project;

  const queryPath = (p: Project) =>
    `/api/v1/projects/${p.id}/analytics/query/clickhouse`;

  const post = async (
    body: Record<string, unknown>,
  ): Promise<{
    status: number;
    body: Body;
  }> => {
    const response = await app.request(queryPath(project), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Auth-Token": project.apiKey,
      },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: (await response.json()) as Body };
  };

  beforeAll(async () => {
    // The surface ships behind the experimental feature switch. The suite runs
    // with it on via the flag's own env override — the same lever a deployment
    // uses.
    process.env.RELEASE_LWQL_WORKBENCH = "1";

    await resetApp();
    globalForApp.__langwatch_app = createTestApp({
      planProvider: PlanProviderService.create({
        getActivePlan: vi
          .fn()
          .mockResolvedValue(FREE_PLAN) as PlanProvider["getActivePlan"],
      }),
      usageLimits: {
        notifyPlanLimitReached: vi.fn().mockResolvedValue(undefined),
        checkAndSendWarning: vi.fn().mockResolvedValue(undefined),
      } as any,
    });

    organization = await prisma.organization.create({
      data: { name: "Granularity org", slug: `granularity-${ns}` },
    });
    team = await prisma.team.create({
      data: {
        name: "Granularity team",
        slug: `granularity-${ns}`,
        organizationId: organization.id,
      },
    });
    project = await prisma.project.create({
      data: {
        ...projectFactory.build({ slug: `granularity-${ns}` }),
        teamId: team.id,
        personalFeatures: {},
      },
    });
  }, 120_000);

  afterAll(async () => {
    delete process.env.RELEASE_LWQL_WORKBENCH;
    // Guarded on the identifiers actually used, so a setup failure halfway
    // through never turns an undefined id into a delete that matches every row.
    if (team && organization) {
      await prisma.project.deleteMany({ where: { teamId: team.id } });
      await prisma.team.delete({ where: { id: team.id } });
      await prisma.organization.delete({ where: { id: organization.id } });
    }
  });

  describe("when a statement declaring the parameter is run at one-second steps over a week", () => {
    /** @scenario "A window that would produce more buckets than the ceiling refuses on the workbench and REST" */
    it("is refused with the named code and the bucket arithmetic in the envelope's meta", async () => {
      const { status, body } = await post({
        sql: GRANULARITY_SQL,
        timeWindow: {
          start: "2026-02-20T00:00:00.000Z",
          end: "2026-02-27T00:00:00.000Z",
        },
        granularitySeconds: 1,
      });

      expect(status).toBe(400);
      expect(body.error.code).toBe("lwql_granularity_too_fine");
      expect(body.error.meta).toMatchObject({
        requestedGranularitySeconds: 1,
        windowSeconds: WEEK_SECONDS,
        maxBuckets: 10_000,
      });
    });
  });

  describe("when the same statement is run at an hour, which fits the ceiling", () => {
    it("gets past the budget gate and reaches the next gate instead", async () => {
      const { status, body } = await post({
        sql: GRANULARITY_SQL,
        timeWindow: {
          start: "2026-02-20T00:00:00.000Z",
          end: "2026-02-27T00:00:00.000Z",
        },
        granularitySeconds: 3600,
      });

      // What this proves is that the refusal above was about the bucket
      // arithmetic and not about the door: at an hour the budget gate lets
      // the request through to whatever gate comes next. Which gate that is
      // depends on the deployment (no LWQL identity -> lwql_unavailable;
      // a provisioned ClickHouse -> the query path itself), so assert only
      // that the budget refusal is gone, not which honest answer follows.
      expect(status).not.toBe(400);
      expect(body.error?.code).not.toBe("lwql_granularity_too_fine");
    });
  });
});
