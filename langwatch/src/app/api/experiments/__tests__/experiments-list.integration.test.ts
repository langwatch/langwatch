/**
 * Integration tests for the public experiments list endpoint.
 *
 * Hits the dev server (default http://localhost:5560) and asserts auth,
 * project scoping, pagination, and the per-experiment shape.
 */
import type { Experiment, Project } from "@prisma/client";
import { ExperimentType } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "~/server/db";
import { getTestProject } from "~/utils/testUtils";

describe.skipIf(process.env.CI)("GET /api/experiments", () => {
  let project: Project;
  const created: Experiment[] = [];

  const getBaseUrl = () =>
    process.env.TEST_BASE_URL ?? "http://localhost:5560";

  beforeAll(async () => {
    project = await getTestProject("experiments-list-test");

    const stamp = Date.now();
    for (let index = 0; index < 3; index++) {
      const exp = await prisma.experiment.create({
        data: {
          projectId: project.id,
          name: `List Test Experiment ${index}`,
          slug: `list-test-${stamp}-${index}`,
          type: ExperimentType.EVALUATIONS_V3,
          workbenchState: { name: `List Test Experiment ${index}` },
        },
      });
      created.push(exp);
    }
  });

  afterAll(async () => {
    for (const exp of created) {
      await prisma.experiment
        .delete({ where: { id: exp.id, projectId: project.id } })
        .catch(() => {
          // best-effort cleanup
        });
    }
  });

  describe("given no api key is provided", () => {
    describe("when calling the endpoint", () => {
      /** @scenario "Unauthenticated request returns 401" */
      it("rejects with 401", async () => {
        const response = await fetch(`${getBaseUrl()}/api/experiments`);
        expect(response.status).toBe(401);
      });
    });
  });

  describe("given a valid api key", () => {
    describe("when calling the endpoint", () => {
      /** @scenario "Authenticated request lists experiments scoped to the project" */
      it("returns 200 with the project's experiments", async () => {
        const response = await fetch(`${getBaseUrl()}/api/experiments`, {
          headers: { "X-Auth-Token": project.apiKey },
        });
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(Array.isArray(body.experiments)).toBe(true);
        expect(body.pagination).toBeDefined();
        const slugs = body.experiments.map((e: { slug: string }) => e.slug);
        for (const exp of created) {
          expect(slugs).toContain(exp.slug);
        }
      });

      it("exposes id, slug, name, type, runsCount, lastRunAt on each entry", async () => {
        const response = await fetch(`${getBaseUrl()}/api/experiments`, {
          headers: { "X-Auth-Token": project.apiKey },
        });
        const body = await response.json();
        const entry = body.experiments.find(
          (e: { slug: string }) => e.slug === created[0]!.slug,
        );
        expect(entry).toMatchObject({
          id: created[0]!.id,
          slug: created[0]!.slug,
          name: created[0]!.name,
          type: ExperimentType.EVALUATIONS_V3,
        });
        expect(typeof entry.runsCount).toBe("number");
        expect("lastRunAt" in entry).toBe(true);
        expect(typeof entry.createdAt).toBe("string");
      });
    });

    describe("when paginating with pageSize=2", () => {
      /** @scenario "Pagination returns the requested page" */
      it("returns at most 2 entries and reports hasMore correctly", async () => {
        const response = await fetch(
          `${getBaseUrl()}/api/experiments?pageSize=2&page=1`,
          { headers: { "X-Auth-Token": project.apiKey } },
        );
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.experiments.length).toBeLessThanOrEqual(2);
        expect(body.pagination.pageSize).toBe(2);
        expect(body.pagination.page).toBe(1);
        if (body.pagination.totalHits > 2) {
          expect(body.pagination.hasMore).toBe(true);
        }
      });
    });
  });
});
