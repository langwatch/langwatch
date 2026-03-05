import type { Evaluator, Organization, Project, Team } from "@prisma/client";
import { nanoid } from "nanoid";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { projectFactory } from "~/factories/project.factory";
import { prisma } from "~/server/db";
import { app } from "../[[...route]]/app";

describe("Evaluators API", () => {
  let testApiKey: string;
  let testProjectId: string;
  let testOrganization: Organization;
  let testTeam: Team;
  let testProject: Project;
  let helpers: {
    api: {
      put: (path: string, body: unknown) => Response | Promise<Response>;
      post: (path: string, body: unknown) => Response | Promise<Response>;
      get: (path: string) => Response | Promise<Response>;
      delete: (path: string) => Response | Promise<Response>;
    };
  };

  const createAuthHeaders = (apiKey: string) => ({
    "X-Auth-Token": apiKey,
    "Content-Type": "application/json",
  });

  beforeEach(async () => {
    testOrganization = await prisma.organization.create({
      data: {
        name: "Test Organization",
        slug: `test-org-${nanoid()}`,
      },
    });

    testTeam = await prisma.team.create({
      data: {
        name: "Test Team",
        slug: `test-team-${nanoid()}`,
        organizationId: testOrganization.id,
      },
    });

    testProject = projectFactory.build({
      slug: nanoid(),
    });
    testProject = await prisma.project.create({
      data: {
        ...testProject,
        teamId: testTeam.id,
      },
    });

    testApiKey = testProject.apiKey;
    testProjectId = testProject.id;

    helpers = {
      api: {
        get: (path: string) =>
          app.request(path, { headers: { "X-Auth-Token": testApiKey } }),
        post: (path: string, body: unknown) =>
          app.request(path, {
            method: "POST",
            headers: createAuthHeaders(testApiKey),
            body: JSON.stringify(body),
          }),
        put: (path: string, body: unknown) =>
          app.request(path, {
            method: "PUT",
            headers: createAuthHeaders(testApiKey),
            body: JSON.stringify(body),
          }),
        delete: (path: string) =>
          app.request(path, {
            method: "DELETE",
            headers: createAuthHeaders(testApiKey),
          }),
      },
    };
  });

  afterEach(async () => {
    await prisma.evaluator.deleteMany({
      where: { projectId: testProjectId },
    });

    await prisma.project.delete({
      where: { id: testProjectId },
    });

    await prisma.team.delete({
      where: { id: testTeam.id },
    });

    await prisma.organization.delete({
      where: { id: testOrganization.id },
    });
  });

  describe("PUT /api/evaluators/:id", () => {
    describe("when the evaluator exists", () => {
      let evaluator: Evaluator;

      beforeEach(async () => {
        evaluator = await prisma.evaluator.create({
          data: {
            id: `evaluator_${nanoid()}`,
            projectId: testProjectId,
            name: "Original Name",
            slug: `original-${nanoid()}`,
            type: "evaluator",
            config: {
              evaluatorType: "langevals/exact_match",
              settings: {},
            },
          },
        });
      });

      it("updates the evaluator name", async () => {
        const res = await helpers.api.put(
          `/api/evaluators/${evaluator.id}`,
          { name: "Updated Name" },
        );

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toMatchObject({
          id: evaluator.id,
          name: "Updated Name",
        });
      });

      it("updates the evaluator config settings", async () => {
        const res = await helpers.api.put(
          `/api/evaluators/${evaluator.id}`,
          {
            config: {
              evaluatorType: "langevals/exact_match",
              settings: { someSetting: "value" },
            },
          },
        );

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.config).toMatchObject({
          evaluatorType: "langevals/exact_match",
          settings: { someSetting: "value" },
        });
      });

      it("rejects changing evaluatorType", async () => {
        const res = await helpers.api.put(
          `/api/evaluators/${evaluator.id}`,
          {
            config: {
              evaluatorType: "openai/moderation",
            },
          },
        );

        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toContain("evaluatorType cannot be changed");
      });

      it("allows sending the same evaluatorType", async () => {
        const res = await helpers.api.put(
          `/api/evaluators/${evaluator.id}`,
          {
            config: {
              evaluatorType: "langevals/exact_match",
              settings: { newSetting: true },
            },
          },
        );

        expect(res.status).toBe(200);
      });
    });

    describe("when the evaluator does not exist", () => {
      it("returns 404", async () => {
        const res = await helpers.api.put(
          "/api/evaluators/nonexistent-id",
          { name: "Updated Name" },
        );

        expect(res.status).toBe(404);
      });
    });
  });

  describe("DELETE /api/evaluators/:id", () => {
    describe("when the evaluator exists", () => {
      let evaluator: Evaluator;

      beforeEach(async () => {
        evaluator = await prisma.evaluator.create({
          data: {
            id: `evaluator_${nanoid()}`,
            projectId: testProjectId,
            name: "Evaluator to archive",
            slug: `archive-${nanoid()}`,
            type: "evaluator",
            config: { evaluatorType: "langevals/exact_match" },
          },
        });
      });

      it("archives the evaluator and returns success", async () => {
        const res = await helpers.api.delete(
          `/api/evaluators/${evaluator.id}`,
        );

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toMatchObject({ success: true });
      });

      it("excludes the archived evaluator from list results", async () => {
        await helpers.api.delete(`/api/evaluators/${evaluator.id}`);

        const listRes = await helpers.api.get("/api/evaluators");

        expect(listRes.status).toBe(200);
        const body = await listRes.json();
        const ids = body.map((e: { id: string }) => e.id);
        expect(ids).not.toContain(evaluator.id);
      });

      it("returns 404 when trying to get archived evaluator", async () => {
        await helpers.api.delete(`/api/evaluators/${evaluator.id}`);

        const getRes = await helpers.api.get(
          `/api/evaluators/${evaluator.id}`,
        );

        expect(getRes.status).toBe(404);
      });
    });

    describe("when the evaluator does not exist", () => {
      it("returns 404", async () => {
        const res = await helpers.api.delete(
          "/api/evaluators/nonexistent-id",
        );

        expect(res.status).toBe(404);
      });
    });
  });
});
