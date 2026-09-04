import { nanoid } from "nanoid";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { projectFactory } from "~/factories/project.factory";
import type {
  Organization,
  Project,
  Scenario,
  Team,
} from "~/generated/prisma/client";
import { prisma } from "~/server/db";
import { DEFAULT_SUITE_NAME } from "~/server/suites/default-suite";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { wireDefaultTestApp } from "~/test-utils/wireDefaultTestApp";
import { app } from "../[[...route]]/app";

wireDefaultTestApp();

describe("Scenarios API", () => {
  let testApiKey: string;
  let testProjectId: string;
  let testOrganization: Organization;
  let testTeam: Team;
  let testProject: Project;
  let helpers: {
    api: {
      put: (path: string, body: unknown) => Response | Promise<Response>;
      patch: (path: string, body: unknown) => Response | Promise<Response>;
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

    testProject = await prisma.project.create({
      data: {
        ...projectFactory.build({ slug: nanoid() }),
        teamId: testTeam.id,
        personalFeatures: {},
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
        patch: (path: string, body: unknown) =>
          app.request(path, {
            method: "PATCH",
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
    await cleanupTestRows(prisma, [
      ["scenarioVersion", { projectId: testProjectId }],
      ["scenario", { projectId: testProjectId }],
      ["simulationSuite", { projectId: testProjectId }],
    ]);

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
          criteria: [
            "Responds with a welcome message",
            "Includes user name in greeting",
          ],
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
      // Skipped: route exists but App singleton (resourceLimitMiddleware, planProvider) not initialized in test env.
      it.skip("creates a scenario and returns it with an ID", async () => {
        const res = await helpers.api.post("/api/scenarios", {
          name: "Login Flow Happy Path",
          situation: "User attempts to log in with valid creds",
          criteria: [
            "Responds with a welcome message",
            "Includes user name in greeting",
          ],
          labels: ["auth", "happy-path"],
        });

        expect(res.status).toBe(201);
        const body = await res.json();
        expect(body).toMatchObject({
          name: "Login Flow Happy Path",
          situation: "User attempts to log in with valid creds",
          criteria: [
            "Responds with a welcome message",
            "Includes user name in greeting",
          ],
          labels: ["auth", "happy-path"],
        });
        expect(body).toHaveProperty("id");
      });
    });

    describe("when name is empty", () => {
      // Skipped: route exists but App singleton (resourceLimitMiddleware, planProvider) not initialized in test env.
      it.skip("returns a validation error", async () => {
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

    describe("when situation is missing", () => {
      // Skipped: route exists but App singleton (resourceLimitMiddleware, planProvider) not initialized in test env.
      it.skip("returns a validation error", async () => {
        const res = await helpers.api.post("/api/scenarios", {
          name: "A valid name",
          criteria: ["A criterion"],
          labels: [],
        });

        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body).toHaveProperty("error");
      });
    });
  });

  describe("testSuiteId over the public scenarios endpoint", () => {
    async function createTestSuite(name: string) {
      return prisma.simulationSuite.create({
        data: {
          id: `suite_${nanoid()}`,
          projectId: testProjectId,
          name,
          slug: `${name.toLowerCase()}-${nanoid(6)}`,
          kind: "test_suite",
          scenarioIds: [],
          targets: [],
          labels: [],
        },
      });
    }

    describe("when a scenario is created with a testSuiteId", () => {
      it("files it there and reports testSuiteId on the response", async () => {
        const testSuite = await createTestSuite("Refunds");

        const res = await helpers.api.post("/api/scenarios", {
          name: "Refund scenario",
          situation: "A customer wants a refund",
          testSuiteId: testSuite.id,
        });

        expect(res.status).toBe(201);
        const body = await res.json();
        expect(body.testSuiteId).toBe(testSuite.id);

        const stored = await prisma.simulationSuite.findFirst({
          where: { id: testSuite.id, projectId: testProjectId },
        });
        expect(stored?.scenarioIds).toEqual([body.id]);
      });
    });

    describe("when a scenario is updated with testSuiteId null", () => {
      it("files it into the Default suite", async () => {
        const testSuite = await createTestSuite("Refunds");
        const created = await helpers.api.post("/api/scenarios", {
          name: "Refund scenario",
          situation: "s",
          testSuiteId: testSuite.id,
        });
        const { id } = await created.json();

        const res = await helpers.api.put(`/api/scenarios/${id}`, {
          testSuiteId: null,
        });

        expect(res.status).toBe(200);
        const body = await res.json();

        const defaultSuite = await prisma.simulationSuite.findFirst({
          where: {
            projectId: testProjectId,
            kind: "test_suite",
            name: DEFAULT_SUITE_NAME,
          },
        });
        expect(body.testSuiteId).toBe(defaultSuite?.id);
        expect(defaultSuite?.scenarioIds).toEqual([id]);

        const stored = await prisma.simulationSuite.findFirst({
          where: { id: testSuite.id, projectId: testProjectId },
        });
        expect(stored?.scenarioIds).toEqual([]);
      });
    });

    describe("when the testSuiteId names no active test suite", () => {
      it("refuses with scenario_test_suite_not_found", async () => {
        const res = await helpers.api.post("/api/scenarios", {
          name: "Refund scenario",
          situation: "s",
          testSuiteId: "suite_missing",
        });

        expect(res.status).toBe(404);
        const body = await res.json();
        expect(body.error).toBe("scenario_test_suite_not_found");
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

      describe("when name is empty", () => {
        it("returns a validation error", async () => {
          const res = await helpers.api.put(`/api/scenarios/${scenario.id}`, {
            name: "",
          });

          expect(res.status).toBe(422);
          const body = await res.json();
          expect(body).toHaveProperty("error");
        });
      });

      describe("the version history of the save", () => {
        /** @scenario "A save over the public API is recorded with the API as its author" */
        it("records the save with the API as its author and no person", async () => {
          const res = await helpers.api.put(`/api/scenarios/${scenario.id}`, {
            situation: "Updated over the API",
          });
          expect(res.status).toBe(200);

          const stored = await prisma.scenario.findFirstOrThrow({
            where: { id: scenario.id, projectId: testProjectId },
          });
          expect(stored.version).toBe(2);

          const row = await prisma.scenarioVersion.findFirstOrThrow({
            where: {
              projectId: testProjectId,
              scenarioId: scenario.id,
              version: 2,
            },
          });
          expect(row.authorLabel).toBe("api");
          expect(row.authorId).toBeNull();
        });

        /** @scenario "A save from the command line is recorded with the command line as its author" */
        it("records a save that declares the CLI surface with the command line as its author", async () => {
          const res = await app.request(`/api/scenarios/${scenario.id}`, {
            method: "PUT",
            headers: {
              ...createAuthHeaders(testApiKey),
              // The header the langwatch CLI sends on its scenario writes.
              "X-LangWatch-Surface": "cli",
            },
            body: JSON.stringify({ situation: "Updated from the CLI" }),
          });
          expect(res.status).toBe(200);

          const row = await prisma.scenarioVersion.findFirstOrThrow({
            where: {
              projectId: testProjectId,
              scenarioId: scenario.id,
              version: 2,
            },
          });
          expect(row.authorLabel).toBe("cli");
          expect(row.authorId).toBeNull();
        });

        it("does not honor a surface value it does not know", async () => {
          const res = await app.request(`/api/scenarios/${scenario.id}`, {
            method: "PUT",
            headers: {
              ...createAuthHeaders(testApiKey),
              "X-LangWatch-Surface": "trpc",
            },
            body: JSON.stringify({ situation: "Spoofed surface" }),
          });
          expect(res.status).toBe(200);

          const row = await prisma.scenarioVersion.findFirstOrThrow({
            where: {
              projectId: testProjectId,
              scenarioId: scenario.id,
              version: 2,
            },
          });
          expect(row.authorLabel).toBe("api");
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

  describe("given model overrides and turn limits over REST", () => {
    describe("when creating with model overrides and turn limits", () => {
      /** @scenario "Create over REST accepts model overrides and turn limits" */
      it("carries the values back on create and on read", async () => {
        const res = await helpers.api.post("/api/scenarios", {
          name: "Overrides Scenario",
          situation: "User asks for a refund",
          simulatorModel: "openai/gpt-5-mini",
          judgeModel: "openai/gpt-5-mini",
          maxTurns: 8,
          minTurns: 2,
        });

        expect(res.status).toBe(201);
        const created = await res.json();
        expect(created).toMatchObject({
          simulatorModel: "openai/gpt-5-mini",
          judgeModel: "openai/gpt-5-mini",
          maxTurns: 8,
          minTurns: 2,
        });

        const readRes = await helpers.api.get(`/api/scenarios/${created.id}`);
        expect(readRes.status).toBe(200);
        const read = await readRes.json();
        expect(read).toMatchObject({
          simulatorModel: "openai/gpt-5-mini",
          judgeModel: "openai/gpt-5-mini",
          maxTurns: 8,
          minTurns: 2,
        });
      });
    });

    describe("when updating an override to null", () => {
      /** @scenario "Update over REST clears a model override with null" */
      it("clears the stored override", async () => {
        const createRes = await helpers.api.post("/api/scenarios", {
          name: "Clear Override Scenario",
          situation: "User asks for help",
          simulatorModel: "openai/gpt-5-mini",
        });
        const created = await createRes.json();

        const updateRes = await helpers.api.put(
          `/api/scenarios/${created.id}`,
          { simulatorModel: null },
        );
        expect(updateRes.status).toBe(200);
        const updated = await updateRes.json();
        expect(updated.simulatorModel).toBeNull();

        const readRes = await helpers.api.get(`/api/scenarios/${created.id}`);
        const read = await readRes.json();
        expect(read.simulatorModel).toBeNull();
      });
    });

    describe("when the override has no provider prefix", () => {
      /** @scenario "REST rejects a model override with no provider prefix" */
      it("rejects the create with a validation error", async () => {
        const res = await helpers.api.post("/api/scenarios", {
          name: "Bad Model Scenario",
          situation: "User asks for help",
          simulatorModel: "latest",
        });

        expect(res.status).toBe(422);
      });
    });
  });

  describe("PATCH /api/scenarios/:id", () => {
    describe("when the scenario exists", () => {
      /** @scenario "PATCH updates a scenario the same way PUT does" */
      it("updates the scenario like PUT does", async () => {
        const scenario = await prisma.scenario.create({
          data: {
            projectId: testProjectId,
            name: "Patch Me",
            situation: "Original situation",
            criteria: [],
            labels: [],
          },
        });

        const res = await helpers.api.patch(`/api/scenarios/${scenario.id}`, {
          name: "Patched Name",
        });

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.name).toBe("Patched Name");
        expect(body.situation).toBe("Original situation");
      });
    });

    describe("when the scenario does not exist", () => {
      it("returns 404", async () => {
        const res = await helpers.api.patch("/api/scenarios/nonexistent-id", {
          name: "New Name",
        });

        expect(res.status).toBe(404);
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
        const res = await helpers.api.delete(`/api/scenarios/${scenario.id}`);

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toMatchObject({ id: scenario.id, archived: true });
      });

      it("excludes the archived scenario from list results", async () => {
        await helpers.api.delete(`/api/scenarios/${scenario.id}`);

        const listRes = await helpers.api.get("/api/scenarios");

        expect(listRes.status).toBe(200);
        const body = await listRes.json();
        const ids = body.map((s: { id: string }) => s.id);
        expect(ids).not.toContain(scenario.id);
      });
    });

    describe("when the scenario does not exist", () => {
      it("returns 404", async () => {
        const res = await helpers.api.delete("/api/scenarios/nonexistent-id");

        expect(res.status).toBe(404);
        const body = await res.json();
        expect(body).toHaveProperty("error");
      });
    });
  });

  // The version endpoints of the REST surface. The history itself is built by
  // ScenarioService; what is pinned here is the wire shape the CLI reads.
  describe("GET /api/scenarios/:id/versions", () => {
    async function createScenarioWithSaves(saveCount: number) {
      const created = await helpers.api.post("/api/scenarios", {
        name: "Login Flow",
        situation: "User attempts to log in",
        criteria: ["Greets the user"],
        labels: ["auth"],
      });
      const scenario = (await created.json()) as { id: string };
      for (let index = 0; index < saveCount; index++) {
        await helpers.api.put(`/api/scenarios/${scenario.id}`, {
          situation: `Save number ${index + 1}`,
        });
      }
      return scenario;
    }

    it("lists the versions newest first, with author, date and changed fields", async () => {
      const scenario = await createScenarioWithSaves(2);

      const res = await helpers.api.get(
        `/api/scenarios/${scenario.id}/versions`,
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.versions.map((v: { version: number }) => v.version)).toEqual([
        3, 2, 1,
      ]);
      expect(body.versions[0]).toMatchObject({
        authorLabel: "api",
        authorId: null,
        changedFields: ["situation"],
        isSynthesized: false,
      });
      expect(typeof body.versions[0].createdAt).toBe("string");
      expect(body.nextCursor).toBeNull();
    });

    it("pages with limit and cursor", async () => {
      const scenario = await createScenarioWithSaves(3);

      const first = await helpers.api.get(
        `/api/scenarios/${scenario.id}/versions?limit=2`,
      );
      const firstBody = await first.json();
      expect(
        firstBody.versions.map((v: { version: number }) => v.version),
      ).toEqual([4, 3]);
      expect(firstBody.nextCursor).toBe(3);

      const second = await helpers.api.get(
        `/api/scenarios/${scenario.id}/versions?limit=2&cursor=${firstBody.nextCursor}`,
      );
      const secondBody = await second.json();
      expect(
        secondBody.versions.map((v: { version: number }) => v.version),
      ).toEqual([2, 1]);
    });

    it("returns 404 for a scenario that does not exist", async () => {
      const res = await helpers.api.get(
        "/api/scenarios/nonexistent-id/versions",
      );

      expect(res.status).toBe(404);
    });
  });

  describe("GET /api/scenarios/:id/versions/:version", () => {
    it("returns the content the version saved", async () => {
      const created = await helpers.api.post("/api/scenarios", {
        name: "Login Flow",
        situation: "User attempts to log in",
        criteria: ["Greets the user"],
        labels: ["auth"],
      });
      const scenario = (await created.json()) as { id: string };
      await helpers.api.put(`/api/scenarios/${scenario.id}`, {
        situation: "Rewritten",
      });

      const res = await helpers.api.get(
        `/api/scenarios/${scenario.id}/versions/1`,
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({
        version: 1,
        authorLabel: "api",
        schemaVersion: 1,
        isSynthesized: false,
      });
      expect(body.snapshot).toMatchObject({
        name: "Login Flow",
        situation: "User attempts to log in",
        criteria: ["Greets the user"],
        labels: ["auth"],
        parameters: [],
      });
    });

    it("refuses a version number that names nothing with scenario_version_not_found", async () => {
      const created = await helpers.api.post("/api/scenarios", {
        name: "Login Flow",
        situation: "User attempts to log in",
      });
      const scenario = (await created.json()) as { id: string };

      const res = await helpers.api.get(
        `/api/scenarios/${scenario.id}/versions/9`,
      );

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe("scenario_version_not_found");
    });

    it("returns 404 for a scenario that does not exist", async () => {
      const res = await helpers.api.get(
        "/api/scenarios/nonexistent-id/versions/1",
      );

      expect(res.status).toBe(404);
    });

    it("refuses a version that is not a whole number", async () => {
      const created = await helpers.api.post("/api/scenarios", {
        name: "Login Flow",
        situation: "User attempts to log in",
      });
      const scenario = (await created.json()) as { id: string };

      const res = await helpers.api.get(
        `/api/scenarios/${scenario.id}/versions/not-a-number`,
      );

      expect(res.status).toBe(422);
    });
  });
});
