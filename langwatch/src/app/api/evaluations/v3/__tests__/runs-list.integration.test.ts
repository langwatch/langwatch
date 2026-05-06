/**
 * Integration tests for GET /api/evaluations/v3/runs?experimentSlug=...
 *
 * Verifies auth, query-param validation, 404 for unknown slugs, and the
 * shape of the runs array (which may be empty for fresh experiments).
 */
import type { Experiment, Project } from "@prisma/client";
import { ExperimentType } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "~/server/db";
import { getTestProject } from "~/utils/testUtils";

describe.skipIf(process.env.CI)("GET /api/evaluations/v3/runs", () => {
  let project: Project;
  let experiment: Experiment;
  const testSlug = `runs-list-test-${Date.now()}`;

  const getBaseUrl = () =>
    process.env.TEST_BASE_URL ?? "http://localhost:5560";

  beforeAll(async () => {
    project = await getTestProject("runs-list-test");
    experiment = await prisma.experiment.create({
      data: {
        projectId: project.id,
        name: "Runs List Test",
        slug: testSlug,
        type: ExperimentType.EVALUATIONS_V3,
        workbenchState: { name: "Runs List Test" },
      },
    });
  });

  afterAll(async () => {
    if (experiment) {
      await prisma.experiment
        .delete({ where: { id: experiment.id, projectId: project.id } })
        .catch(() => {
          // best-effort cleanup
        });
    }
  });

  describe("given no api key is provided", () => {
    describe("when calling the endpoint", () => {
      it("rejects with 401", async () => {
        const response = await fetch(
          `${getBaseUrl()}/api/evaluations/v3/runs?experimentSlug=${testSlug}`,
        );
        expect(response.status).toBe(401);
      });
    });
  });

  describe("given a valid api key", () => {
    describe("when experimentSlug is missing", () => {
      it("rejects with 400", async () => {
        const response = await fetch(
          `${getBaseUrl()}/api/evaluations/v3/runs`,
          { headers: { "X-Auth-Token": project.apiKey } },
        );
        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body.error).toMatch(/experimentSlug/);
      });
    });

    describe("when the experiment slug is unknown", () => {
      it("returns 404", async () => {
        const response = await fetch(
          `${getBaseUrl()}/api/evaluations/v3/runs?experimentSlug=does-not-exist-${Date.now()}`,
          { headers: { "X-Auth-Token": project.apiKey } },
        );
        expect(response.status).toBe(404);
      });
    });

    describe("when the experiment exists", () => {
      it("returns 200 with a runs array (possibly empty)", async () => {
        const response = await fetch(
          `${getBaseUrl()}/api/evaluations/v3/runs?experimentSlug=${testSlug}`,
          { headers: { "X-Auth-Token": project.apiKey } },
        );
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.experimentSlug).toBe(testSlug);
        expect(body.experimentId).toBe(experiment.id);
        expect(Array.isArray(body.runs)).toBe(true);
        expect(body.pagination).toMatchObject({
          page: 1,
          pageSize: 50,
        });
      });
    });
  });
});
