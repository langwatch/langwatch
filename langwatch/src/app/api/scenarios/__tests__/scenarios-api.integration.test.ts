import type { Organization, Project, Scenario, Team } from "@prisma/client";
import { nanoid } from "nanoid";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { projectFactory } from "~/factories/project.factory";
import { prisma } from "~/server/db";
import { app } from "../[[...route]]/app";

describe("Scenarios API", () => {
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
    await prisma.scenario.deleteMany({
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
      const res = await app.request("/api/scenarios", {
        headers: { "X-Auth-Token": "invalid-key" },
      });

      expect(res.status).toBe(401);
    });
  });

  describe("GET /api/scenarios", () => {
    describe("when no scenarios exist", () => {
      it("returns an empty array", async () => {
        const res = await helpers.api.get("/api/scenarios");

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(Array.isArray(body)).toBe(true);
        expect(body.length).toBe(0);
      });
    });

    describe("when scenarios exist", () => {
      let scenario: Scenario;

      beforeEach(async () => {
        scenario = await prisma.scenario.create({
          data: {
            projectId: testProjectId,
            name: "Login Flow",
            situation: "User attempts to log in with valid credentials",
            criteria: [
              "Responds with a welcome message",
              "Includes user name in greeting",
            ],
            labels: ["auth", "happy-path"],
          },
        });
      });

      it("returns all scenarios for the project", async () => {
        const res = await helpers.api.get("/api/scenarios");

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.length).toBe(1);
        expect(body[0].id).toBe(scenario.id);
      });

      it("excludes archived scenarios", async () => {
        await prisma.scenario.update({
          where: { id: scenario.id },
          data: { archivedAt: new Date() },
        });

        const res = await helpers.api.get("/api/scenarios");

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.length).toBe(0);
      });
    });
  });

  describe("GET /api/scenarios/:id", () => {
    describe("when the scenario exists", () => {
      let scenario: Scenario;

      beforeEach(async () => {
        scenario = await prisma.scenario.create({
          data: {
            projectId: testProjectId,
            name: "Login Flow",
            situation: "User attempts to log in with valid credentials",
            criteria: [
              "Responds with a welcome message",
              "Includes user name in greeting",
            ],
            labels: ["auth", "happy-path"],
          },
        });
      });

      it("returns the scenario with all fields", async () => {
        const res = await helpers.api.get(`/api/scenarios/${scenario.id}`);

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toMatchObject({
          id: scenario.id,
          name: "Login Flow",
          situation: "User attempts to log in with valid credentials",
          criteria: ["Responds with a welcome message", "Includes user name in greeting"],
          labels: ["auth", "happy-path"],
        });
      });
    });

    describe("when the scenario does not exist", () => {
      it("returns 404", async () => {
        const res = await helpers.api.get("/api/scenarios/nonexistent-id");

        expect(res.status).toBe(404);
        const body = await res.json();
        expect(body).toHaveProperty("error");
      });
    });
  });

  describe("POST /api/scenarios", () => {
    describe("when given valid data", () => {
      it("creates a scenario and returns it with an ID", async () => {
        const res = await helpers.api.post("/api/scenarios", {
          name: "Login Flow Happy Path",
          situation: "User attempts to log in with valid creds",
          criteria: [
            "Responds with a welcome message",
            "Includes user name in greeting",
          ],
          labels: ["auth", "happy-path"],
        });

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toMatchObject({
          name: "Login Flow Happy Path",
          situation: "User attempts to log in with valid creds",
          criteria: ["Responds with a welcome message", "Includes user name in greeting"],
          labels: ["auth", "happy-path"],
        });
        expect(body).toHaveProperty("id");
      });
    });

    describe("when name is empty", () => {
      it("returns a validation error", async () => {
        const res = await helpers.api.post("/api/scenarios", {
          name: "",
          situation: "Some situation",
          criteria: ["A criterion"],
          labels: [],
        });

        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body).toHaveProperty("error");
      });
    });
  });

  describe("PUT /api/scenarios/:id", () => {
    describe("when the scenario exists", () => {
      let scenario: Scenario;

      beforeEach(async () => {
        scenario = await prisma.scenario.create({
          data: {
            projectId: testProjectId,
            name: "Original Name",
            situation: "Original situation",
            criteria: ["Original criterion"],
            labels: ["original"],
          },
        });
      });

      it("updates the scenario and returns the updated version", async () => {
        const res = await helpers.api.put(`/api/scenarios/${scenario.id}`, {
          name: "Updated Name",
          situation: "Updated situation",
          criteria: ["Updated criterion 1", "Updated criterion 2"],
          labels: ["updated"],
        });

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toMatchObject({
          id: scenario.id,
          name: "Updated Name",
          situation: "Updated situation",
          criteria: ["Updated criterion 1", "Updated criterion 2"],
          labels: ["updated"],
        });
      });
    });

    describe("when the scenario does not exist", () => {
      it("returns 404", async () => {
        const res = await helpers.api.put("/api/scenarios/nonexistent-id", {
          name: "Updated Name",
        });

        expect(res.status).toBe(404);
        const body = await res.json();
        expect(body).toHaveProperty("error");
      });
    });
  });

  describe("DELETE /api/scenarios/:id", () => {
    describe("when the scenario exists", () => {
      let scenario: Scenario;

      beforeEach(async () => {
        scenario = await prisma.scenario.create({
          data: {
            projectId: testProjectId,
            name: "Scenario to archive",
            situation: "Will be archived",
            criteria: ["Some criterion"],
            labels: ["disposable"],
          },
        });
      });

      it("archives the scenario and returns success", async () => {
        const res = await helpers.api.delete(
          `/api/scenarios/${scenario.id}`
        );

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toMatchObject({ id: scenario.id, archived: true });
      });

      it("excludes the archived scenario from list results", async () => {
        await helpers.api.delete(`/api/scenarios/${scenario.id}`);

        const listRes = await helpers.api.get("/api/scenarios");

        expect(listRes.status).toBe(200);
        const body = await listRes.json();
        const ids = body.map((s: Scenario) => s.id);
        expect(ids).not.toContain(scenario.id);
      });
    });

    describe("when the scenario does not exist", () => {
      it("returns 404", async () => {
        const res = await helpers.api.delete(
          "/api/scenarios/nonexistent-id"
        );

        expect(res.status).toBe(404);
        const body = await res.json();
        expect(body).toHaveProperty("error");
      });
    });
  });
});
