import type { Organization, Project, Team } from "@prisma/client";
import { nanoid } from "nanoid";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { projectFactory } from "~/factories/project.factory";
import { prisma } from "~/server/db";

// Mock the resource-limit middleware so tests don't need the full app layer.
// The middleware calls getApp() which requires initializeDefaultApp() — not available in tests.
vi.mock("~/app/api/middleware/resource-limit", () => ({
  resourceLimitMiddleware: () => async (_c: unknown, next: () => Promise<void>) => {
    await next();
  },
}));

// Import app AFTER the mock is set up
const { app } = await import("../[[...route]]/app");

describe("Feature: Dataset REST API", () => {
  let testApiKey: string;
  let testProjectId: string;
  let testOrganization: Organization;
  let testTeam: Team;
  let testProject: Project;
  let helpers: {
    api: {
      get: (path: string) => Response | Promise<Response>;
      post: (path: string, body: unknown) => Response | Promise<Response>;
      patch: (path: string, body: unknown) => Response | Promise<Response>;
      delete: (path: string, body?: unknown) => Response | Promise<Response>;
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

    testProject = projectFactory.build({ slug: nanoid() });
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
        patch: (path: string, body: unknown) =>
          app.request(path, {
            method: "PATCH",
            headers: createAuthHeaders(testApiKey),
            body: JSON.stringify(body),
          }),
        delete: (path: string, body?: unknown) =>
          app.request(path, {
            method: "DELETE",
            ...(body
              ? {
                  body: JSON.stringify(body),
                  headers: createAuthHeaders(testApiKey),
                }
              : { headers: { "X-Auth-Token": testApiKey } }),
          }),
      },
    };
  });

  afterEach(async () => {
    // Guard: skip cleanup if beforeEach failed before creating test data
    if (!testProjectId) return;

    await prisma.datasetRecord.deleteMany({
      where: { projectId: testProjectId },
    });
    await prisma.dataset.deleteMany({
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

  // Helper to create a dataset directly via Prisma
  async function createDataset(overrides: {
    name: string;
    slug: string;
    archivedAt?: Date | null;
    id?: string;
  }) {
    return await prisma.dataset.create({
      data: {
        id: overrides.id ?? `dataset_${nanoid()}`,
        name: overrides.name,
        slug: overrides.slug,
        projectId: testProjectId,
        columnTypes: [
          { name: "input", type: "string" },
          { name: "output", type: "string" },
        ],
        archivedAt: overrides.archivedAt ?? null,
      },
    });
  }

  // Helper to create a dataset record directly via Prisma
  async function createRecord(
    datasetId: string,
    recordId: string,
    entry: Record<string, string>,
  ) {
    return await prisma.datasetRecord.create({
      data: {
        id: recordId,
        datasetId,
        projectId: testProjectId,
        entry: entry as any,
      },
    });
  }

  // ── Authentication ─────────────────────────────────────────────

  describe("Authentication", () => {
    it("returns 401 without X-Auth-Token header", async () => {
      const res = await app.request("/api/dataset");
      expect(res.status).toBe(401);
    });

    it("returns 401 with invalid X-Auth-Token", async () => {
      const res = await app.request("/api/dataset", {
        headers: { "X-Auth-Token": "invalid-key-xyz" },
      });
      expect(res.status).toBe(401);
    });
  });

  // ── List Datasets ──────────────────────────────────────────────

  describe("GET /api/dataset", () => {
    describe("when the project has 3 datasets and 1 archived dataset", () => {
      beforeEach(async () => {
        await createDataset({ name: "Dataset A", slug: "dataset-a" });
        await createDataset({ name: "Dataset B", slug: "dataset-b" });
        await createDataset({ name: "Dataset C", slug: "dataset-c" });
        await createDataset({
          name: "Archived",
          slug: "archived-xyz",
          archivedAt: new Date(),
        });
      });

      it("returns paginated non-archived datasets", async () => {
        const res = await helpers.api.get("/api/dataset");
        expect(res.status).toBe(200);

        const body = await res.json();
        expect(body.data).toHaveLength(3);
        expect(body.pagination.total).toBe(3);
      });

      it("includes id, name, slug, columnTypes, and record count", async () => {
        const res = await helpers.api.get("/api/dataset");
        const body = await res.json();

        for (const dataset of body.data) {
          expect(dataset).toHaveProperty("id");
          expect(dataset).toHaveProperty("name");
          expect(dataset).toHaveProperty("slug");
          expect(dataset).toHaveProperty("columnTypes");
          expect(dataset).toHaveProperty("recordCount");
        }
      });

      it("excludes the archived dataset", async () => {
        const res = await helpers.api.get("/api/dataset");
        const body = await res.json();
        const names = body.data.map((d: { name: string }) => d.name);
        expect(names).not.toContain("Archived");
      });
    });

    describe("when the project has 15 datasets", () => {
      beforeEach(async () => {
        for (let i = 1; i <= 15; i++) {
          await createDataset({
            name: `Dataset ${i}`,
            slug: `dataset-${i}`,
          });
        }
      });

      it("paginates with page and limit parameters", async () => {
        const res = await helpers.api.get("/api/dataset?page=2&limit=5");
        expect(res.status).toBe(200);

        const body = await res.json();
        expect(body.data).toHaveLength(5);
        expect(body.pagination).toMatchObject({
          page: 2,
          limit: 5,
          total: 15,
          totalPages: 3,
        });
      });
    });

    describe("when the project has no datasets", () => {
      it("returns a paginated response with 0 datasets", async () => {
        const res = await helpers.api.get("/api/dataset");
        expect(res.status).toBe(200);

        const body = await res.json();
        expect(body.data).toHaveLength(0);
        expect(body.pagination.total).toBe(0);
      });
    });
  });

  // ── Create Dataset ─────────────────────────────────────────────

  describe("POST /api/dataset", () => {
    describe("when given valid name and columnTypes", () => {
      it("creates a dataset with the correct slug", async () => {
        const res = await helpers.api.post("/api/dataset", {
          name: "User Feedback",
          columnTypes: [
            { name: "input", type: "string" },
            { name: "output", type: "string" },
          ],
        });

        expect(res.status).toBe(201);
        const body = await res.json();
        expect(body).toHaveProperty("id");
        expect(body.name).toBe("User Feedback");
        expect(body.slug).toBe("user-feedback");
        expect(body.columnTypes).toEqual([
          { name: "input", type: "string" },
          { name: "output", type: "string" },
        ]);
      });
    });

    describe("when a dataset with the same slug already exists", () => {
      beforeEach(async () => {
        await createDataset({ name: "Test Data", slug: "test-data" });
      });

      it("returns 409 Conflict", async () => {
        const res = await helpers.api.post("/api/dataset", {
          name: "Test Data",
          columnTypes: [{ name: "input", type: "string" }],
        });

        expect(res.status).toBe(409);
        const body = await res.json();
        expect(body.error).toContain("Conflict");
      });
    });

    describe("when columnTypes contain an invalid type", () => {
      it("returns 422 Unprocessable Entity", async () => {
        const res = await helpers.api.post("/api/dataset", {
          name: "Bad Types",
          columnTypes: [{ name: "col1", type: "invalid_type" }],
        });

        expect(res.status).toBe(422);
      });
    });

    describe("when name is missing", () => {
      it("returns 422 Unprocessable Entity", async () => {
        const res = await helpers.api.post("/api/dataset", {
          columnTypes: [{ name: "input", type: "string" }],
        });

        expect(res.status).toBe(422);
      });
    });
  });

  // ── Get Single Dataset ─────────────────────────────────────────

  describe("GET /api/dataset/:slugOrId", () => {
    describe("when the dataset exists", () => {
      let datasetId: string;

      beforeEach(async () => {
        const dataset = await createDataset({
          name: "My Dataset",
          slug: "my-dataset",
          id: "dataset_abc123",
        });
        datasetId = dataset.id;

        await createRecord(datasetId, "rec-1", { input: "hello" });
      });

      it("returns the dataset by slug with its records", async () => {
        const res = await helpers.api.get("/api/dataset/my-dataset");
        expect(res.status).toBe(200);

        const body = await res.json();
        expect(body).toHaveProperty("id");
        expect(body).toHaveProperty("name");
        expect(body).toHaveProperty("slug");
        expect(body).toHaveProperty("columnTypes");
        expect(body.data).toHaveLength(1);
      });

      it("returns the dataset by id", async () => {
        const res = await helpers.api.get("/api/dataset/dataset_abc123");
        expect(res.status).toBe(200);

        const body = await res.json();
        expect(body.id).toBe("dataset_abc123");
      });
    });

    describe("when the dataset does not exist", () => {
      it("returns 404 Not Found", async () => {
        const res = await helpers.api.get("/api/dataset/does-not-exist");
        expect(res.status).toBe(404);
      });
    });
  });

  // ── Update Dataset ─────────────────────────────────────────────

  describe("PATCH /api/dataset/:slugOrId", () => {
    describe("when updating name and columnTypes", () => {
      beforeEach(async () => {
        await createDataset({ name: "Old Name", slug: "old-name" });
      });

      it("updates the dataset and changes the slug", async () => {
        const res = await helpers.api.patch("/api/dataset/old-name", {
          name: "New Name",
          columnTypes: [{ name: "question", type: "string" }],
        });

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.name).toBe("New Name");
        expect(body.slug).toBe("new-name");
        expect(body.columnTypes).toEqual([
          { name: "question", type: "string" },
        ]);
      });
    });

    describe("when updating only the name", () => {
      beforeEach(async () => {
        await createDataset({ name: "Original", slug: "original" });
      });

      it("regenerates the slug", async () => {
        const res = await helpers.api.patch("/api/dataset/original", {
          name: "Renamed Dataset",
        });

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.slug).toBe("renamed-dataset");
      });
    });

    describe("when the new slug conflicts with an existing dataset", () => {
      beforeEach(async () => {
        await createDataset({ name: "Alpha", slug: "alpha" });
        await createDataset({ name: "Beta", slug: "beta" });
      });

      it("returns 409 Conflict", async () => {
        const res = await helpers.api.patch("/api/dataset/alpha", {
          name: "Beta",
        });

        expect(res.status).toBe(409);
      });
    });

    describe("when the dataset does not exist", () => {
      it("returns 404 Not Found", async () => {
        const res = await helpers.api.patch("/api/dataset/ghost", {
          name: "Whatever",
        });

        expect(res.status).toBe(404);
      });
    });

    describe("when the project has reached its dataset plan limit", () => {
      let existingDatasetSlug: string;

      beforeEach(async () => {
        const dataset = await createDataset({
          name: "Existing",
          slug: "existing",
        });
        existingDatasetSlug = dataset.slug;
      });

      it("updates the dataset successfully (no plan limit on PATCH)", async () => {
        const res = await helpers.api.patch(
          `/api/dataset/${existingDatasetSlug}`,
          {
            name: "Updated Name",
          },
        );

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.name).toBe("Updated Name");
      });
    });
  });

  // ── Delete (Archive) Dataset ───────────────────────────────────

  describe("DELETE /api/dataset/:slugOrId", () => {
    describe("when the dataset exists", () => {
      beforeEach(async () => {
        await createDataset({ name: "To Delete", slug: "to-delete" });
      });

      it("soft-deletes with archivedAt and mutates slug", async () => {
        const res = await helpers.api.delete("/api/dataset/to-delete");
        expect(res.status).toBe(200);

        const body = await res.json();
        expect(body.archived).toBe(true);

        // Verify it's archived in DB
        const archived = await prisma.dataset.findFirst({
          where: {
            projectId: testProjectId,
            name: "To Delete",
          },
        });
        expect(archived?.archivedAt).not.toBeNull();
        expect(archived?.slug).toContain("archived");
      });

      it("returns 404 on subsequent GET", async () => {
        await helpers.api.delete("/api/dataset/to-delete");
        const getRes = await helpers.api.get("/api/dataset/to-delete");
        expect(getRes.status).toBe(404);
      });
    });

    describe("when the dataset does not exist", () => {
      it("returns 404 Not Found", async () => {
        const res = await helpers.api.delete("/api/dataset/nope");
        expect(res.status).toBe(404);
      });
    });
  });

  // ── List Records ───────────────────────────────────────────────

  describe("GET /api/dataset/:slugOrId/records", () => {
    describe("when the dataset has 100 records", () => {
      beforeEach(async () => {
        const dataset = await createDataset({
          name: "My Dataset",
          slug: "my-dataset",
        });
        const records = Array.from({ length: 100 }, (_, i) => ({
          id: `rec-${i + 1}`,
          datasetId: dataset.id,
          projectId: testProjectId,
          entry: { input: `input-${i + 1}` },
        }));
        await prisma.datasetRecord.createMany({ data: records });
      });

      it("returns the first page of records with pagination metadata", async () => {
        const res = await helpers.api.get("/api/dataset/my-dataset/records");
        expect(res.status).toBe(200);

        const body = await res.json();
        expect(body.data.length).toBeGreaterThan(0);
        expect(body.pagination.total).toBe(100);
      });

      it("paginates with explicit page and limit", async () => {
        const res = await helpers.api.get(
          "/api/dataset/my-dataset/records?page=3&limit=20",
        );
        expect(res.status).toBe(200);

        const body = await res.json();
        expect(body.data).toHaveLength(20);
        expect(body.pagination).toMatchObject({
          page: 3,
          limit: 20,
          total: 100,
          totalPages: 5,
        });
      });
    });

    describe("when the dataset does not exist", () => {
      it("returns 404 Not Found", async () => {
        const res = await helpers.api.get("/api/dataset/ghost/records");
        expect(res.status).toBe(404);
      });
    });
  });

  // ── Update Record ──────────────────────────────────────────────

  describe("PATCH /api/dataset/:slugOrId/records/:recordId", () => {
    describe("when the record exists", () => {
      let datasetId: string;

      beforeEach(async () => {
        const dataset = await createDataset({
          name: "My Dataset",
          slug: "my-dataset",
        });
        datasetId = dataset.id;
        await createRecord(datasetId, "rec-123", { input: "hello" });
      });

      it("updates the record entry", async () => {
        const res = await helpers.api.patch(
          "/api/dataset/my-dataset/records/rec-123",
          { entry: { input: "updated" } },
        );

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.entry).toEqual({ input: "updated" });
      });
    });

    describe("when the record does not exist", () => {
      beforeEach(async () => {
        await createDataset({ name: "My Dataset", slug: "my-dataset" });
      });

      it("creates the record (upsert)", async () => {
        const res = await helpers.api.patch(
          "/api/dataset/my-dataset/records/rec-new",
          { entry: { input: "new" } },
        );

        expect(res.status).toBe(201);
        const body = await res.json();
        expect(body.id).toBe("rec-new");
        expect(body.entry).toEqual({ input: "new" });
      });
    });

    describe("when the dataset does not exist", () => {
      it("returns 404 Not Found", async () => {
        const res = await helpers.api.patch(
          "/api/dataset/ghost/records/rec-1",
          { entry: { input: "x" } },
        );

        expect(res.status).toBe(404);
      });
    });
  });

  // ── Delete Records (Batch) ─────────────────────────────────────

  describe("DELETE /api/dataset/:slugOrId/records", () => {
    describe("when records exist", () => {
      let datasetId: string;

      beforeEach(async () => {
        const dataset = await createDataset({
          name: "My Dataset",
          slug: "my-dataset",
        });
        datasetId = dataset.id;
        await createRecord(datasetId, "rec-1", { input: "a" });
        await createRecord(datasetId, "rec-2", { input: "b" });
        await createRecord(datasetId, "rec-3", { input: "c" });
      });

      it("deletes the specified records and returns count", async () => {
        const res = await helpers.api.delete(
          "/api/dataset/my-dataset/records",
          { recordIds: ["rec-1", "rec-2"] },
        );

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.deletedCount).toBe(2);
      });
    });

    describe("when no matching record IDs exist", () => {
      beforeEach(async () => {
        await createDataset({ name: "My Dataset", slug: "my-dataset" });
      });

      it("returns 404 Not Found", async () => {
        const res = await helpers.api.delete(
          "/api/dataset/my-dataset/records",
          { recordIds: ["nonexistent"] },
        );

        expect(res.status).toBe(404);
        const body = await res.json();
        expect(body.error).toContain("No matching records");
      });
    });

    describe("when the dataset does not exist", () => {
      it("returns 404 Not Found", async () => {
        const res = await helpers.api.delete("/api/dataset/ghost/records", {
          recordIds: ["rec-1"],
        });

        expect(res.status).toBe(404);
      });
    });

    describe("when recordIds is missing from body", () => {
      beforeEach(async () => {
        await createDataset({ name: "My Dataset", slug: "my-dataset" });
      });

      it("returns 422 Unprocessable Entity", async () => {
        const res = await helpers.api.delete(
          "/api/dataset/my-dataset/records",
          {},
        );

        expect(res.status).toBe(422);
      });
    });
  });

  // ── Cross-Cutting: Slug or ID Resolution ───────────────────────

  describe("Slug or ID resolution", () => {
    describe("when a dataset has both slug and id", () => {
      let datasetId: string;

      beforeEach(async () => {
        const dataset = await createDataset({
          name: "My Data",
          slug: "my-data",
          id: "dataset_xyz",
        });
        datasetId = dataset.id;
      });

      it("returns the same dataset for both slug and id", async () => {
        const resBySlug = await helpers.api.get("/api/dataset/my-data");
        const resById = await helpers.api.get("/api/dataset/dataset_xyz");

        expect(resBySlug.status).toBe(200);
        expect(resById.status).toBe(200);

        const bodyBySlug = await resBySlug.json();
        const bodyById = await resById.json();

        expect(bodyBySlug.id).toBe(bodyById.id);
        expect(bodyBySlug.slug).toBe(bodyById.slug);
      });
    });
  });
});
