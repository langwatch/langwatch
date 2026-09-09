/**
 * @vitest-environment node
 *
 * @see specs/analytics/filter-value-validation.feature
 *
 * Drives both REST analytics paths the way the customer report did: a project
 * API key in `X-Auth-Token`, and a `traces.error` filter carrying the option's
 * LABEL instead of its value. Both used to answer 200 with the unfiltered
 * numbers.
 */

import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app as analyticsApp } from "~/app/api/analytics/[...route]/app";
import type { Organization, Project, Team } from "~/generated/prisma/client";
import { prisma } from "~/server/db";
import { app as miscApp } from "~/server/routes/misc";
import { wireDefaultTestApp } from "~/test-utils/wireDefaultTestApp";

wireDefaultTestApp();

const ns = `analytics-filters-${nanoid(8)}`;

let organization: Organization;
let team: Team;
let project: Project;

beforeAll(async () => {
  organization = await prisma.organization.create({
    data: { name: `Org ${ns}`, slug: `--test-org-${ns}` },
  });
  team = await prisma.team.create({
    data: {
      name: `Team ${ns}`,
      slug: `--test-team-${ns}`,
      organizationId: organization.id,
    },
  });
  project = await prisma.project.create({
    data: {
      name: `Project ${ns}`,
      slug: `--test-project-${ns}`,
      teamId: team.id,
      language: "python",
      framework: "openai",
      apiKey: `test-pkey-${ns}`,
    },
  });
}, 120_000);

afterAll(async () => {
  await prisma.project
    .deleteMany({ where: { slug: { contains: ns } } })
    .catch(() => {});
  await prisma.team
    .deleteMany({ where: { slug: { contains: ns } } })
    .catch(() => {});
  await prisma.organization
    .deleteMany({ where: { slug: { contains: ns } } })
    .catch(() => {});
});

const now = Date.now();

function body(filters: Record<string, string[]>) {
  return JSON.stringify({
    startDate: now - 24 * 60 * 60 * 1000,
    endDate: now,
    timeZone: "UTC",
    filters,
    series: [{ metric: "metadata.trace_id", aggregation: "cardinality" }],
    timeScale: 1,
  });
}

function headers() {
  return {
    "X-Auth-Token": project.apiKey,
    "Content-Type": "application/json",
  };
}

describe("Feature: analytics rejects filter values it cannot apply", () => {
  describe("given a project API key that may read analytics", () => {
    /** @scenario "The REST endpoint refuses a filter value it cannot apply" */
    it("refuses an option label on POST /api/analytics/timeseries", async () => {
      const res = await analyticsApp.request("/api/analytics/timeseries", {
        method: "POST",
        headers: headers(),
        body: body({ "traces.error": ["Traces with error"] }),
      });

      expect(res.status).toBe(422);
      const payload = (await res.json()) as {
        error: string;
        reasons?: Array<{ code: string; meta?: Record<string, unknown> }>;
      };
      expect(payload.error).toBe("validation_error");
      expect(payload.reasons?.[0]?.meta).toMatchObject({
        field: "filters.traces.error",
        type: "unsupported_filter_value",
        expected: ["true", "false"],
        received: "Traces with error",
      });
    });

    /** @scenario "The legacy REST analytics path refuses the same value" */
    it("refuses an option label on the legacy POST /api/analytics", async () => {
      const res = await miscApp.request("/api/analytics", {
        method: "POST",
        headers: headers(),
        body: body({ "traces.error": ["Traces without error"] }),
      });

      expect(res.status).toBe(422);
      const payload = (await res.json()) as { error: string };
      expect(payload.error).toBe("validation_error");
    });

    it("still refuses a filter field that is not a filter field at all", async () => {
      const res = await analyticsApp.request("/api/analytics/timeseries", {
        method: "POST",
        headers: headers(),
        body: body({ "traces.not_a_field": ["true"] }),
      });

      expect(res.status).toBe(422);
    });
  });
});
