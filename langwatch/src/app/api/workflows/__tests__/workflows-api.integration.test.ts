import type { Organization, Project, Team, Workflow } from "@prisma/client";
import { nanoid } from "nanoid";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { projectFactory } from "~/factories/project.factory";
import { prisma } from "~/server/db";
import { app } from "../[[...route]]/app";

describe("Workflows REST API", () => {
  let testApiKey: string;
  let testProjectId: string;
  let testOrganization: Organization;
  let testTeam: Team;
  let testProject: Project;
  let helpers: {
    api: {
      get: (path: string) => Response | Promise<Response>;
      delete: (path: string) => Response | Promise<Response>;
    };
  };

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
        delete: (path: string) =>
          app.request(path, {
            method: "DELETE",
            headers: { "X-Auth-Token": testApiKey },
          }),
      },
    };
  });

  afterEach(async () => {
    await prisma.workflow.deleteMany({
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

  describe("Authentication", () => {
    it("returns 401 with invalid API key", async () => {
      const res = await app.request("/api/workflows", {
        headers: { "X-Auth-Token": "invalid-key" },
      });

      expect(res.status).toBe(401);
    });
  });

  describe("GET /api/workflows", () => {
    describe("when no workflows exist", () => {
      it("returns an empty array", async () => {
        const res = await helpers.api.get("/api/workflows");

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(Array.isArray(body)).toBe(true);
        expect(body.length).toBe(0);
      });
    });

    describe("when workflows exist", () => {
      let workflow: Workflow;

      beforeEach(async () => {
        workflow = await prisma.workflow.create({
          data: {
            id: `workflow_${nanoid()}`,
            projectId: testProjectId,
            name: "Test Workflow",
            description: "A test workflow",
            icon: "🔄",
            isEvaluator: false,
            isComponent: false,
          },
        });
      });

      it("returns all workflows for the project", async () => {
        const res = await helpers.api.get("/api/workflows");

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.length).toBe(1);
        expect(body[0].id).toBe(workflow.id);
        expect(body[0].name).toBe("Test Workflow");
        expect(body[0].description).toBe("A test workflow");
      });

      it("excludes archived workflows", async () => {
        await prisma.workflow.update({
          where: { id: workflow.id },
          data: { archivedAt: new Date() },
        });

        const res = await helpers.api.get("/api/workflows");

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.length).toBe(0);
      });
    });
  });

  describe("GET /api/workflows/:id", () => {
    describe("when the workflow exists", () => {
      let workflow: Workflow;

      beforeEach(async () => {
        workflow = await prisma.workflow.create({
          data: {
            id: `workflow_${nanoid()}`,
            projectId: testProjectId,
            name: "Test Workflow",
            description: "A test workflow",
            icon: "🧪",
            isEvaluator: true,
            isComponent: false,
          },
        });
      });

      it("returns the workflow with all fields", async () => {
        const res = await helpers.api.get(`/api/workflows/${workflow.id}`);

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toMatchObject({
          id: workflow.id,
          name: "Test Workflow",
          description: "A test workflow",
          isEvaluator: true,
          isComponent: false,
        });
      });
    });

    describe("when the workflow does not exist", () => {
      it("returns 404", async () => {
        const res = await helpers.api.get("/api/workflows/nonexistent-id");

        expect(res.status).toBe(404);
        const body = await res.json();
        expect(body).toHaveProperty("error");
      });
    });
  });

  describe("DELETE /api/workflows/:id", () => {
    describe("when the workflow exists", () => {
      let workflow: Workflow;

      beforeEach(async () => {
        workflow = await prisma.workflow.create({
          data: {
            id: `workflow_${nanoid()}`,
            projectId: testProjectId,
            name: "Workflow to archive",
            description: "Will be archived",
            icon: "📦",
            isEvaluator: false,
            isComponent: false,
          },
        });
      });

      it("archives the workflow and returns success", async () => {
        const res = await helpers.api.delete(`/api/workflows/${workflow.id}`);

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toMatchObject({ id: workflow.id, archived: true });
      });

      it("excludes the archived workflow from list results", async () => {
        await helpers.api.delete(`/api/workflows/${workflow.id}`);

        const listRes = await helpers.api.get("/api/workflows");

        expect(listRes.status).toBe(200);
        const body = await listRes.json();
        const ids = body.map((w: { id: string }) => w.id);
        expect(ids).not.toContain(workflow.id);
      });
    });

    describe("when the workflow does not exist", () => {
      it("returns 404", async () => {
        const res = await helpers.api.delete("/api/workflows/nonexistent-id");

        expect(res.status).toBe(404);
        const body = await res.json();
        expect(body).toHaveProperty("error");
      });
    });
  });
});
