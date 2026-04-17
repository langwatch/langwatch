import type { Organization, Project, Team } from "@prisma/client";
import { nanoid } from "nanoid";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { projectFactory } from "~/factories/project.factory";
import { globalForApp, resetApp } from "~/server/app-layer/app";
import { createTestApp } from "~/server/app-layer/presets";
import {
  PlanProviderService,
  type PlanProvider,
} from "~/server/app-layer/subscription/plan-provider";
import { prisma } from "~/server/db";
import type { DatasetColumns } from "~/server/datasets/types";
import { FREE_PLAN } from "../../../../../ee/licensing/constants";
import { app } from "../[[...route]]/app";

// Skipped: app-layer init regression on main (#2508) — see langwatch/langwatch#3240.
describe.skip("Feature: Dataset File Upload REST API", () => {
  let testApiKey: string;
  let testProjectId: string;
  let testOrganization: Organization;
  let testTeam: Team;
  let testProject: Project;
  let mockGetActivePlan: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    resetApp();
    mockGetActivePlan = vi.fn().mockResolvedValue(FREE_PLAN);
    globalForApp.__langwatch_app = createTestApp({
      planProvider: PlanProviderService.create({
        getActivePlan: mockGetActivePlan as PlanProvider["getActivePlan"],
      }),
      usageLimits: {
        notifyPlanLimitReached: vi.fn().mockResolvedValue(undefined),
        checkAndSendWarning: vi.fn().mockResolvedValue(undefined),
      } as any,
    });

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
  });

  afterEach(async () => {
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
    resetApp();
  });

  // Helper: create a dataset directly via Prisma
  async function createDataset(overrides: {
    name: string;
    slug: string;
    id?: string;
    columnTypes?: DatasetColumns;
  }) {
    return await prisma.dataset.create({
      data: {
        id: overrides.id ?? `dataset_${nanoid()}`,
        name: overrides.name,
        slug: overrides.slug,
        projectId: testProjectId,
        columnTypes: overrides.columnTypes ?? [
          { name: "input", type: "string" },
          { name: "output", type: "string" },
        ],
      },
    });
  }

  // Helper: build multipart form data for upload
  function buildFormData(params: {
    file?: { content: string; filename: string };
    name?: string;
  }): FormData {
    const form = new FormData();
    if (params.file) {
      const blob = new Blob([params.file.content], {
        type: "application/octet-stream",
      });
      form.append("file", blob, params.file.filename);
    }
    if (params.name !== undefined) {
      form.append("name", params.name);
    }
    return form;
  }

  // Helper: make an upload request
  function uploadToExisting(
    slugOrId: string,
    formData: FormData,
    apiKey?: string,
  ) {
    return app.request(`/api/dataset/${slugOrId}/upload`, {
      method: "POST",
      headers: { "X-Auth-Token": apiKey ?? testApiKey },
      body: formData,
    });
  }

  function createAndUpload(formData: FormData, apiKey?: string) {
    return app.request("/api/dataset/upload", {
      method: "POST",
      headers: { "X-Auth-Token": apiKey ?? testApiKey },
      body: formData,
    });
  }

  // ── Upload to Existing Dataset ─────────────────────────────────

  describe("POST /api/dataset/:slugOrId/upload", () => {
    describe("when uploading a CSV file to an existing dataset", () => {
      beforeEach(async () => {
        await createDataset({
          name: "User Feedback",
          slug: "user-feedback",
          columnTypes: [
            { name: "input", type: "string" },
            { name: "output", type: "string" },
          ],
        });
      });

      it("creates records and returns 200", async () => {
        const csv = "input,output\nhello,Hi there!\ngoodbye,See you later!";
        const form = buildFormData({
          file: { content: csv, filename: "data.csv" },
        });
        const res = await uploadToExisting("user-feedback", form);

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.recordsCreated).toBe(2);
      });

      it("persists the records in the database", async () => {
        const csv = "input,output\nhello,Hi there!\ngoodbye,See you later!";
        const form = buildFormData({
          file: { content: csv, filename: "data.csv" },
        });
        await uploadToExisting("user-feedback", form);

        const dataset = await prisma.dataset.findFirst({
          where: { slug: "user-feedback", projectId: testProjectId },
        });
        const records = await prisma.datasetRecord.findMany({
          where: { datasetId: dataset!.id, projectId: testProjectId },
        });
        expect(records).toHaveLength(2);
      });
    });

    describe("when uploading a JSONL file to an existing dataset", () => {
      beforeEach(async () => {
        await createDataset({
          name: "Logs",
          slug: "logs",
          columnTypes: [
            { name: "message", type: "string" },
            { name: "level", type: "string" },
          ],
        });
      });

      it("creates records and returns 200", async () => {
        const jsonl =
          '{"message": "started", "level": "info"}\n{"message": "crashed", "level": "error"}';
        const form = buildFormData({
          file: { content: jsonl, filename: "logs.jsonl" },
        });
        const res = await uploadToExisting("logs", form);

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.recordsCreated).toBe(2);
      });
    });

    describe("when uploading a JSON array file to an existing dataset", () => {
      beforeEach(async () => {
        await createDataset({
          name: "Items",
          slug: "items",
          columnTypes: [
            { name: "name", type: "string" },
            { name: "price", type: "number" },
          ],
        });
      });

      it("creates records and returns 200", async () => {
        const json =
          '[{"name": "Widget", "price": "9.99"}, {"name": "Gadget", "price": "19.99"}, {"name": "Doohickey", "price": "4.50"}]';
        const form = buildFormData({
          file: { content: json, filename: "items.json" },
        });
        const res = await uploadToExisting("items", form);

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.recordsCreated).toBe(3);
      });
    });

    describe("when uploading converts values to match column types", () => {
      beforeEach(async () => {
        await createDataset({
          name: "Typed",
          slug: "typed",
          columnTypes: [
            { name: "count", type: "number" },
            { name: "active", type: "boolean" },
            { name: "created", type: "date" },
          ],
        });
      });

      it("coerces string values to numbers, booleans, and dates", async () => {
        const csv = "count,active,created\n42,true,2024-01-15";
        const form = buildFormData({
          file: { content: csv, filename: "typed.csv" },
        });
        const res = await uploadToExisting("typed", form);

        expect(res.status).toBe(200);

        const dataset = await prisma.dataset.findFirst({
          where: { slug: "typed", projectId: testProjectId },
        });
        const records = await prisma.datasetRecord.findMany({
          where: { datasetId: dataset!.id, projectId: testProjectId },
        });
        const entry = records[0]!.entry as Record<string, unknown>;
        expect(entry.count).toBe(42);
        expect(entry.active).toBe(true);
        expect(entry.created).toBe("2024-01-15");
      });
    });

    describe("when uploading to dataset referenced by ID", () => {
      beforeEach(async () => {
        await createDataset({
          name: "By ID",
          slug: "by-id",
          id: "dataset_abc123",
          columnTypes: [
            { name: "input", type: "string" },
            { name: "output", type: "string" },
          ],
        });
      });

      it("adds records to the dataset", async () => {
        const csv = "input,output\nhello,world";
        const form = buildFormData({
          file: { content: csv, filename: "data.csv" },
        });
        const res = await uploadToExisting("dataset_abc123", form);

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.recordsCreated).toBe(1);
      });
    });

    describe("when file columns do not match dataset columns", () => {
      beforeEach(async () => {
        await createDataset({
          name: "Strict",
          slug: "strict",
          columnTypes: [{ name: "input", type: "string" }],
        });
      });

      it("returns 400 Bad Request", async () => {
        const csv = "question,answer\nWhat?,42";
        const form = buildFormData({
          file: { content: csv, filename: "data.csv" },
        });
        const res = await uploadToExisting("strict", form);

        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.message).toMatch(/columns do not match/i);
      });
    });

    describe("when uploading to a non-existent dataset", () => {
      it("returns 404 Not Found", async () => {
        const csv = "input,output\nhello,world";
        const form = buildFormData({
          file: { content: csv, filename: "data.csv" },
        });
        const res = await uploadToExisting("does-not-exist", form);

        expect(res.status).toBe(404);
      });
    });

    describe("when no file is attached", () => {
      beforeEach(async () => {
        await createDataset({ name: "Empty", slug: "empty" });
      });

      it("returns 422 Unprocessable Entity", async () => {
        const form = new FormData();
        const res = await uploadToExisting("empty", form);

        expect(res.status).toBe(422);
      });
    });

    describe("when uploading an empty CSV file (headers only)", () => {
      beforeEach(async () => {
        await createDataset({
          name: "Empty",
          slug: "empty",
          columnTypes: [
            { name: "input", type: "string" },
            { name: "output", type: "string" },
          ],
        });
      });

      it("returns 422 Unprocessable Entity", async () => {
        const csv = "input,output\n";
        const form = buildFormData({
          file: { content: csv, filename: "empty.csv" },
        });
        const res = await uploadToExisting("empty", form);

        expect(res.status).toBe(422);
        const body = await res.json();
        expect(body.message).toMatch(/no data rows/i);
      });
    });

    describe("when uploading a file exceeding the row limit", () => {
      beforeEach(async () => {
        await createDataset({
          name: "Big",
          slug: "big",
          columnTypes: [{ name: "value", type: "string" }],
        });
      });

      it("returns 400 Bad Request", async () => {
        const header = "value";
        const rows = Array.from({ length: 10_001 }, (_, i) => `row${i}`);
        const csv = [header, ...rows].join("\n");
        const form = buildFormData({
          file: { content: csv, filename: "big.csv" },
        });
        const res = await uploadToExisting("big", form);

        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.message).toMatch(/10.?000/);
      });
    });

    describe("when uploading a file exceeding the size limit", () => {
      beforeEach(async () => {
        await createDataset({
          name: "Big",
          slug: "big",
          columnTypes: [{ name: "value", type: "string" }],
        });
      });

      it("returns 400 Bad Request", async () => {
        // Create content larger than 25MB
        const bigContent = "value\n" + "x".repeat(26 * 1024 * 1024);
        const form = buildFormData({
          file: { content: bigContent, filename: "big.csv" },
        });
        const res = await uploadToExisting("big", form);

        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.message).toMatch(/25MB/i);
      });
    });

    describe("when uploading an unsupported file format", () => {
      beforeEach(async () => {
        await createDataset({ name: "Any", slug: "any" });
      });

      it("returns 422 Unprocessable Entity", async () => {
        const form = buildFormData({
          file: { content: "some binary data", filename: "data.xlsx" },
        });
        const res = await uploadToExisting("any", form);

        expect(res.status).toBe(422);
        const body = await res.json();
        expect(body.message).toMatch(/unsupported file format/i);
      });
    });
  });

  // ── Create + Upload in One Call ────────────────────────────────

  describe("POST /api/dataset/upload", () => {
    describe("when creating a new dataset from a CSV file", () => {
      it("creates the dataset with inferred columns and returns 201", async () => {
        const csv = "question,answer\nWhat is 2+2?,4\nCapital of UK?,London";
        const form = buildFormData({
          file: { content: csv, filename: "data.csv" },
          name: "From CSV",
        });
        const res = await createAndUpload(form);

        expect(res.status).toBe(201);
        const body = await res.json();
        expect(body.name).toBe("From CSV");
        expect(body.slug).toBe("from-csv");
        expect(body.columnTypes).toEqual([
          { name: "question", type: "string" },
          { name: "answer", type: "string" },
        ]);
        expect(body.recordsCreated).toBe(2);
      });
    });

    describe("when creating a new dataset from a JSONL file", () => {
      it("creates the dataset with inferred columns", async () => {
        const jsonl =
          '{"message": "started", "level": "info"}\n{"message": "crashed", "level": "error"}';
        const form = buildFormData({
          file: { content: jsonl, filename: "logs.jsonl" },
          name: "Logs",
        });
        const res = await createAndUpload(form);

        expect(res.status).toBe(201);
        const body = await res.json();
        expect(body.name).toBe("Logs");
        expect(body.columnTypes).toEqual([
          { name: "message", type: "string" },
          { name: "level", type: "string" },
        ]);
      });
    });

    describe("when creating infers column types as string by default", () => {
      it("creates all columns with type 'string'", async () => {
        const csv = "age,active,notes\n25,true,hello";
        const form = buildFormData({
          file: { content: csv, filename: "data.csv" },
          name: "Inferred",
        });
        const res = await createAndUpload(form);

        expect(res.status).toBe(201);
        const body = await res.json();
        expect(body.columnTypes).toEqual([
          { name: "age", type: "string" },
          { name: "active", type: "string" },
          { name: "notes", type: "string" },
        ]);
      });
    });

    describe("when creating renames reserved column names", () => {
      it("renames 'id' to 'id_' and 'selected' to 'selected_'", async () => {
        const csv = "id,input,selected\n1,hello,true";
        const form = buildFormData({
          file: { content: csv, filename: "data.csv" },
          name: "Reserved",
        });
        const res = await createAndUpload(form);

        expect(res.status).toBe(201);
        const body = await res.json();
        const columnNames = (body.columnTypes as DatasetColumns).map(
          (c: { name: string }) => c.name,
        );
        expect(columnNames).toContain("id_");
        expect(columnNames).toContain("input");
        expect(columnNames).toContain("selected_");

        // Verify records use renamed column names
        const records = await prisma.datasetRecord.findMany({
          where: {
            datasetId: body.id,
            projectId: testProjectId,
          },
        });
        const entry = records[0]!.entry as Record<string, unknown>;
        expect(entry).toHaveProperty("id_");
        expect(entry).toHaveProperty("selected_");
      });
    });

    describe("when name field is missing", () => {
      it("returns 422 Unprocessable Entity", async () => {
        const csv = "col1,col2\na,b";
        const form = buildFormData({
          file: { content: csv, filename: "data.csv" },
        });
        const res = await createAndUpload(form);

        expect(res.status).toBe(422);
      });
    });

    describe("when file field is missing", () => {
      it("returns 422 Unprocessable Entity", async () => {
        const form = new FormData();
        form.append("name", "No File");
        const res = await createAndUpload(form);

        expect(res.status).toBe(422);
      });
    });

    describe("when the project has reached its dataset plan limit", () => {
      beforeEach(async () => {
        await createDataset({ name: "Existing", slug: "existing" });
        mockGetActivePlan.mockResolvedValue({
          ...FREE_PLAN,
          maxDatasets: 1,
          overrideAddingLimitations: false,
        });
      });

      it("returns 403 Forbidden", async () => {
        const csv = "input\nhello";
        const form = buildFormData({
          file: { content: csv, filename: "data.csv" },
          name: "Over Limit",
        });
        const res = await createAndUpload(form);

        expect(res.status).toBe(403);
        const body = await res.json();
        expect(body.error).toBe("resource_limit_exceeded");
      });
    });

    describe("when slug conflicts with existing dataset", () => {
      beforeEach(async () => {
        await createDataset({ name: "Duplicate", slug: "duplicate" });
      });

      it("returns 409 Conflict", async () => {
        const csv = "input\nhello";
        const form = buildFormData({
          file: { content: csv, filename: "data.csv" },
          name: "Duplicate",
        });
        const res = await createAndUpload(form);

        expect(res.status).toBe(409);
      });
    });

    describe("when file exceeds row limit", () => {
      it("returns 400 Bad Request", async () => {
        const header = "value";
        const rows = Array.from({ length: 10_001 }, (_, i) => `row${i}`);
        const csv = [header, ...rows].join("\n");
        const form = buildFormData({
          file: { content: csv, filename: "big.csv" },
          name: "Too Big",
        });
        const res = await createAndUpload(form);

        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.message).toMatch(/10.?000/);
      });
    });
  });

  // ── Authentication ─────────────────────────────────────────────

  describe("Authentication", () => {
    describe("when uploading without X-Auth-Token header", () => {
      it("returns 401 for create+upload", async () => {
        const form = buildFormData({
          file: { content: "input\nhello", filename: "data.csv" },
          name: "Test",
        });
        const res = await app.request("/api/dataset/upload", {
          method: "POST",
          body: form,
        });
        expect(res.status).toBe(401);
      });

      it("returns 401 for upload to existing", async () => {
        const form = buildFormData({
          file: { content: "input\nhello", filename: "data.csv" },
        });
        const res = await app.request("/api/dataset/some-dataset/upload", {
          method: "POST",
          body: form,
        });
        expect(res.status).toBe(401);
      });
    });
  });
});
