/**
 * @vitest-environment node
 */
import {
  createAppRestSecurity,
  getRoutePolicy,
  type AppRestSecurity,
  type RestApiServicePorts,
} from "@langwatch/api/rest";
import { HandledError } from "@langwatch/handled-error";
import { UploadValidationError } from "@langwatch/dataset-contract";
import type { ErrorHandler, MiddlewareHandler } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { DatasetApp } from "../dataset.app";
import { createDatasetRestApp } from "../../transport/api-rest/dataset.api";

const NOW = new Date("2026-08-24T00:00:00.000Z");

const dataset = {
  id: "dataset_1",
  name: "My Dataset",
  slug: "my-dataset",
  columnTypes: [
    { name: "input", type: "string" },
    { name: "output", type: "string" },
  ],
  createdAt: NOW,
  updatedAt: NOW,
};

/**
 * A domain error as the service raises it: a plain `Error` whose NAME is the
 * discriminant the family's own `onError` and its inline `catch` blocks read.
 */
function domainError(name: string, message: string): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

/**
 * The process's own boundary renderer, reached only for what the family's own
 * handler did not claim. Reduced to the one fact these tests read back: a
 * handled refusal keeps its own status and its own `code` in `error`.
 */
const boundaryErrorHandler: ErrorHandler = (error, c) => {
  if (HandledError.isHandled(error)) {
    const serialized = error.serialize();
    return c.json(
      {
        error: serialized.code,
        message: error.message,
        ...serialized.meta,
        reasons: serialized.reasons,
      },
      serialized.httpStatus as 400,
    );
  }
  return c.json({ error: "internal_server_error" }, 500);
};

/** Every enforcement step the builder chose for the route under test. */
function testSecurity({ refuse = false } = {}): { security: AppRestSecurity; chain: string[] } {
  const chain: string[] = [];
  const record =
    (label: string): MiddlewareHandler =>
    async (_c, next) => {
      chain.push(label);
      await next();
    };
  const authenticateProject: MiddlewareHandler = async (c, next) => {
    chain.push("authenticateProject");
    if (refuse) return c.json({ error: "unauthorized" }, 401);
    c.set("project", {
      id: "project-1",
      name: "Project One",
      slug: "project-one",
      teamId: "team-1",
      organizationId: "organization-1",
      isPersonal: false,
      ownerUserId: null,
    });
    await next();
  };

  const ports: RestApiServicePorts = {
    appContext: async (_c, next) => next(),
    requestLogger: () => async (_c, next) => next(),
    requestTracer: () => async (_c, next) => next(),
    legacyErrorHandler: boundaryErrorHandler,
    canonicalErrorHandler: boundaryErrorHandler,
    authenticateProject: () => authenticateProject,
    authorizeProjectPermission: ({ permission }) => record(`authorize:${permission}`),
    authorizeApiKeyCeiling: ({ permission }) => record(`ceiling:${permission}`),
    authenticateOrganization: () => record("authenticateOrganization"),
    authorizeOrganizationPermission: ({ permission }) => record(`authorizeOrg:${permission}`),
    authorizeRouteTeamPermission: () => async (_c, next) => next(),
    authorizeRouteProjectPermission: ({ permission }) =>
      record(`authorizeRouteProject:${permission}`),
    authenticateOrganizationThrowing: record("authenticateOrganizationThrowing"),
    authorizeOrganizationPermissionThrowing: (permission) =>
      record(`authorizeOrgThrowing:${permission}`),
  };

  return { security: createAppRestSecurity(ports), chain };
}

function buildApi(overrides: Record<string, unknown> = {}, options: { refuse?: boolean } = {}) {
  const { security, chain } = testSecurity(options);
  const stub = {
    listDatasets: vi.fn(async () => ({
      data: [{ ...dataset, recordCount: 2 }],
      pagination: { page: 1, limit: 50, total: 1, totalPages: 1 },
    })),
    upsertDataset: vi.fn(async () => dataset),
    getDatasetWithRecords: vi.fn(async () => ({
      dataset,
      records: [{ id: "rec-1", entry: { input: "hello" } }],
      truncated: false,
    })),
    listRecords: vi.fn(async () => ({
      data: [{ id: "rec-1", entry: { input: "hello" } }],
      pagination: { page: 1, limit: 50, total: 1, totalPages: 1 },
    })),
    batchCreateRecords: vi.fn(async () => [{ id: "rec-1", entry: { input: "hello" } }]),
    upsertRecord: vi.fn(async () => ({
      record: { id: "rec-1", entry: { input: "hello" } },
      created: false,
    })),
    deleteRecords: vi.fn(async () => ({ count: 2 })),
    archiveDataset: vi.fn(async () => ({ id: "dataset_1", archived: true as const })),
    ...overrides,
  } as unknown as DatasetApp;

  const family = createDatasetRestApp({
    security,
    app: () => stub,
    platformUrl: ({ projectSlug, path }) => `https://app.langwatch.test/${projectSlug}${path}`,
    // Resolving the caller for a browser→storage upload reads sessions, API
    // keys and role bindings out of the process's database, so it arrives as a
    // port. These tests never drive a direct-upload route, only assert that it
    // declares handler-managed authentication.
    authorizeDirectUpload: async () => ({ ok: false, status: 401, error: "not exercised" }),
  });

  return { hono: family.hono, stub, chain };
}

const jsonHeaders = { "content-type": "application/json" };

const send = (
  hono: ReturnType<typeof buildApi>["hono"],
  method: string,
  path: string,
  body?: unknown,
) =>
  hono.request(path, {
    method,
    ...(body === undefined ? {} : { headers: jsonHeaders, body: JSON.stringify(body) }),
  });

/** A multipart body carrying one file under the field the upload doors read. */
const formWithFile = (filename: string, content: string) => {
  const form = new FormData();
  form.set("file", new File([content], filename, { type: "text/plain" }));
  return form;
};

const upload = (hono: ReturnType<typeof buildApi>["hono"], path: string, body: FormData) =>
  hono.request(path, { method: "POST", body });

describe("createDatasetRestApp", () => {
  describe("given the mounted family", () => {
    it("declares view on the reads", async () => {
      const list = buildApi();
      await list.hono.request("/api/dataset");
      expect(list.chain).toEqual(["authenticateProject", "authorize:datasets:view"]);

      const read = buildApi();
      await read.hono.request("/api/dataset/my-dataset");
      expect(read.chain).toEqual(["authenticateProject", "authorize:datasets:view"]);

      const records = buildApi();
      await records.hono.request("/api/dataset/my-dataset/records");
      expect(records.chain).toEqual(["authenticateProject", "authorize:datasets:view"]);
    });

    it("declares create on the create and update on the row writes", async () => {
      const create = buildApi();
      await send(create.hono, "POST", "/api/dataset", { name: "New" });
      expect(create.chain).toEqual(["authenticateProject", "authorize:datasets:create"]);

      const append = buildApi();
      await send(append.hono, "POST", "/api/dataset/my-dataset/records", {
        entries: [{ input: "hi" }],
      });
      expect(append.chain).toEqual(["authenticateProject", "authorize:datasets:update"]);

      const editRow = buildApi();
      await send(editRow.hono, "PATCH", "/api/dataset/my-dataset/records/rec-1", {
        entry: { input: "hi" },
      });
      expect(editRow.chain).toEqual(["authenticateProject", "authorize:datasets:update"]);
    });

    it("keeps the column-set change and both destructions at manage", async () => {
      const patch = buildApi();
      await send(patch.hono, "PATCH", "/api/dataset/my-dataset", { name: "Renamed" });
      expect(patch.chain).toEqual(["authenticateProject", "authorize:datasets:manage"]);

      const archive = buildApi();
      await send(archive.hono, "DELETE", "/api/dataset/my-dataset");
      expect(archive.chain).toEqual(["authenticateProject", "authorize:datasets:manage"]);

      const deleteRows = buildApi();
      await send(deleteRows.hono, "DELETE", "/api/dataset/my-dataset/records", {
        recordIds: ["rec-1"],
      });
      expect(deleteRows.chain).toEqual(["authenticateProject", "authorize:datasets:manage"]);
    });

    it("declares create on the file upload that makes a new dataset", async () => {
      buildApi();

      expect(getRoutePolicy("POST", "/api/dataset/upload")?.policy).toMatchObject({
        kind: "permission",
        permission: "datasets:create",
      });
    });

    it("marks the browser upload routes as authenticating inside their own handlers", async () => {
      buildApi();

      // The in-app upload UI arrives with a session cookie, which the
      // API-key-only chain would refuse, so these routes resolve the caller
      // themselves through the injected authorizer.
      for (const [method, path] of [
        ["POST", "/api/dataset/direct-upload"],
        ["PUT", "/api/dataset/direct-upload/staging/:uploadId"],
        ["POST", "/api/dataset/direct-upload/:datasetId/finalize"],
        ["DELETE", "/api/dataset/direct-upload/:datasetId"],
      ] as const) {
        expect(getRoutePolicy(method, path)?.policy.kind).toBe("handlerManaged");
      }
    });
  });

  describe("when the project's datasets are listed", () => {
    /**
     * @scenario "List datasets with page and limit parameters"
     */
    it("passes the page window through and links each row into the app", async () => {
      const { hono, stub } = buildApi();

      const response = await hono.request("/api/dataset?page=2&limit=5");

      expect(response.status).toBe(200);
      expect(stub.listDatasets).toHaveBeenCalledWith({
        projectId: "project-1",
        page: 2,
        limit: 5,
      });
      await expect(response.json()).resolves.toMatchObject({
        data: [
          {
            id: "dataset_1",
            name: "My Dataset",
            slug: "my-dataset",
            recordCount: 2,
            platformUrl: "https://app.langwatch.test/project-one/datasets/dataset_1",
          },
        ],
        pagination: { page: 1, limit: 50, total: 1, totalPages: 1 },
      });
    });

    it("defaults the window when the caller names none", async () => {
      const { hono, stub } = buildApi();

      await hono.request("/api/dataset");

      expect(stub.listDatasets).toHaveBeenCalledWith({
        projectId: "project-1",
        page: 1,
        limit: 50,
      });
    });
  });

  describe("when a dataset is created", () => {
    it("answers 201 with the row and its link", async () => {
      const { hono, stub } = buildApi();

      const response = await send(hono, "POST", "/api/dataset", {
        name: "User Feedback",
        columnTypes: [{ name: "input", type: "string" }],
      });

      expect(response.status).toBe(201);
      expect(stub.upsertDataset).toHaveBeenCalledWith({
        projectId: "project-1",
        name: "User Feedback",
        columnTypes: [{ name: "input", type: "string" }],
      });
      await expect(response.json()).resolves.toMatchObject({
        id: "dataset_1",
        slug: "my-dataset",
        platformUrl: "https://app.langwatch.test/project-one/datasets/dataset_1",
      });
    });

    /**
     * @scenario "Create a dataset requires a name"
     */
    it("refuses a body with no name", async () => {
      const { hono, stub } = buildApi();

      const response = await send(hono, "POST", "/api/dataset", {
        columnTypes: [{ name: "input", type: "string" }],
      });

      expect(response.status).toBe(422);
      expect(stub.upsertDataset).not.toHaveBeenCalled();
    });

    /**
     * @scenario "Create a dataset validates column types"
     */
    it("refuses a column whose type is not one the dataset understands", async () => {
      const { hono, stub } = buildApi();

      const response = await send(hono, "POST", "/api/dataset", {
        name: "Bad Types",
        columnTypes: [{ name: "col1", type: "invalid_type" }],
      });

      expect(response.status).toBe(422);
      expect(stub.upsertDataset).not.toHaveBeenCalled();
    });

    /**
     * @scenario "Create a dataset auto-generates a unique slug from the name"
     */
    it("answers 409 when the slug the name produces is already taken", async () => {
      const { hono } = buildApi({
        upsertDataset: vi.fn(async () => {
          throw domainError("DatasetConflictError", "slug taken");
        }),
      });

      const response = await send(hono, "POST", "/api/dataset", { name: "Test Data" });

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({ error: "Conflict" });
    });
  });

  describe("when one dataset is read whole", () => {
    /**
     * @scenario "Get a dataset by slug"
     */
    it("asks for it under the family's own read ceiling", async () => {
      const { hono, stub } = buildApi();

      const response = await hono.request("/api/dataset/my-dataset");

      expect(response.status).toBe(200);
      expect(stub.getDatasetWithRecords).toHaveBeenCalledWith({
        slugOrId: "my-dataset",
        projectId: "project-1",
        limitMb: 25,
      });
      await expect(response.json()).resolves.toMatchObject({
        id: "dataset_1",
        slug: "my-dataset",
        data: [{ id: "rec-1", entry: { input: "hello" } }],
      });
    });

    /**
     * @scenario "Get dataset enforces 25MB response size limit"
     */
    it("refuses rather than truncating when the read exceeds that ceiling", async () => {
      const { hono } = buildApi({
        getDatasetWithRecords: vi.fn(async () => ({
          dataset,
          records: [],
          truncated: true,
        })),
      });

      const response = await hono.request("/api/dataset/large-dataset");

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        message: expect.stringContaining("25MB limit"),
      });
    });

    /**
     * @scenario "Get dataset returns 404 for non-existent slug"
     */
    it("answers 404 for a slug that names no dataset", async () => {
      const { hono } = buildApi({
        getDatasetWithRecords: vi.fn(async () => {
          throw domainError("DatasetNotFoundError", "no such dataset");
        }),
      });

      const response = await hono.request("/api/dataset/does-not-exist");

      expect(response.status).toBe(404);
    });

    it("answers 425 with the lifecycle state while the dataset is still preparing", async () => {
      const { hono } = buildApi({
        getDatasetWithRecords: vi.fn(async () => {
          const error = domainError("DatasetNotReadyError", "still preparing");
          Object.assign(error, { status: "processing" });
          throw error;
        }),
      });

      const response = await hono.request("/api/dataset/still-preparing");

      expect(response.status).toBe(425);
      await expect(response.json()).resolves.toMatchObject({
        error: "DatasetNotReady",
        status: "processing",
      });
    });
  });

  describe("when a dataset is patched", () => {
    it("names it by slug and leaves the fill to the application", async () => {
      const { hono, stub } = buildApi();

      const response = await send(hono, "PATCH", "/api/dataset/old-name", { name: "New Name" });

      expect(response.status).toBe(200);
      // The name and columns this patch did not send are the application's to
      // take from the row being replaced; the door sends only what arrived.
      expect(stub.upsertDataset).toHaveBeenCalledWith({
        projectId: "project-1",
        slugOrId: "old-name",
        name: "New Name",
        columnTypes: undefined,
      });
    });

    /**
     * @scenario "Update a dataset fails when new slug conflicts"
     */
    it("answers 409 when the new name collides with another dataset", async () => {
      const { hono } = buildApi({
        upsertDataset: vi.fn(async () => {
          throw domainError("DatasetConflictError", "slug taken");
        }),
      });

      const response = await send(hono, "PATCH", "/api/dataset/alpha", { name: "Beta" });

      expect(response.status).toBe(409);
    });

    /**
     * @scenario "Update a non-existent dataset returns 404"
     */
    it("answers 404 when the project has no such dataset", async () => {
      const { hono } = buildApi({
        upsertDataset: vi.fn(async () => {
          throw domainError("DatasetNotFoundError", "no such dataset");
        }),
      });

      const response = await send(hono, "PATCH", "/api/dataset/ghost", { name: "Whatever" });

      expect(response.status).toBe(404);
    });
  });

  describe("when a dataset is archived", () => {
    it("answers what the application archived", async () => {
      const { hono, stub } = buildApi();

      const response = await send(hono, "DELETE", "/api/dataset/to-delete");

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ id: "dataset_1", archived: true });
      expect(stub.archiveDataset).toHaveBeenCalledWith({
        slugOrId: "to-delete",
        projectId: "project-1",
      });
    });

    /**
     * @scenario "Delete a non-existent dataset returns 404"
     */
    it("answers 404 for a slug that names no dataset", async () => {
      const { hono } = buildApi({
        archiveDataset: vi.fn(async () => {
          throw domainError("DatasetNotFoundError", "no such dataset");
        }),
      });

      const response = await send(hono, "DELETE", "/api/dataset/nope");

      expect(response.status).toBe(404);
    });
  });

  describe("when a dataset's records are paged", () => {
    it("passes the page window through", async () => {
      const { hono, stub } = buildApi();

      const response = await hono.request("/api/dataset/my-dataset/records?page=3&limit=20");

      expect(response.status).toBe(200);
      expect(stub.listRecords).toHaveBeenCalledWith({
        slugOrId: "my-dataset",
        projectId: "project-1",
        page: 3,
        limit: 20,
      });
    });

    /**
     * @scenario "List records for non-existent dataset returns 404"
     */
    it("answers 404 for a dataset that does not exist", async () => {
      const { hono } = buildApi({
        listRecords: vi.fn(async () => {
          throw domainError("DatasetNotFoundError", "no such dataset");
        }),
      });

      const response = await hono.request("/api/dataset/ghost/records");

      expect(response.status).toBe(404);
    });
  });

  describe("when one record is written by id", () => {
    /**
     * @scenario "Update a record entry"
     * @scenario "Update a non-existent record creates it"
     */
    it("answers 200 when it replaced one and 201 when it created one", async () => {
      const replaced = buildApi();
      const replacedResponse = await send(
        replaced.hono,
        "PATCH",
        "/api/dataset/my-dataset/records/rec-1",
        { entry: { input: "updated" } },
      );
      expect(replacedResponse.status).toBe(200);

      const created = buildApi({
        upsertRecord: vi.fn(async () => ({
          record: { id: "rec-new", entry: { input: "new" } },
          created: true,
        })),
      });
      const createdResponse = await send(
        created.hono,
        "PATCH",
        "/api/dataset/my-dataset/records/rec-new",
        { entry: { input: "new" } },
      );
      expect(createdResponse.status).toBe(201);
      await expect(createdResponse.json()).resolves.toEqual({
        id: "rec-new",
        entry: { input: "new" },
      });
    });

    /**
     * @scenario "Update a record for non-existent dataset returns 404"
     */
    it("answers 404 when the dataset does not exist", async () => {
      const { hono } = buildApi({
        upsertRecord: vi.fn(async () => {
          throw domainError("DatasetNotFoundError", "no such dataset");
        }),
      });

      const response = await send(hono, "PATCH", "/api/dataset/ghost/records/rec-1", {
        entry: { input: "x" },
      });

      expect(response.status).toBe(404);
    });
  });

  describe("when records are appended in a batch", () => {
    /**
     * @scenario "Batch create records via POST /:slugOrId/records"
     */
    it("answers 201 with the rows it created", async () => {
      const { hono, stub } = buildApi();

      const response = await send(hono, "POST", "/api/dataset/my-dataset/records", {
        entries: [{ input: "hello" }],
      });

      expect(response.status).toBe(201);
      expect(stub.batchCreateRecords).toHaveBeenCalledWith({
        slugOrId: "my-dataset",
        projectId: "project-1",
        entries: [{ input: "hello" }],
      });
      await expect(response.json()).resolves.toEqual({
        data: [{ id: "rec-1", entry: { input: "hello" } }],
      });
    });

    /**
     * @scenario "Batch create records requires entries in body"
     */
    it("refuses a body with no entries", async () => {
      const { hono, stub } = buildApi();

      const response = await send(hono, "POST", "/api/dataset/my-dataset/records", {});

      expect(response.status).toBe(422);
      expect(stub.batchCreateRecords).not.toHaveBeenCalled();
    });

    /**
     * @scenario "Batch create records enforces maximum batch size"
     */
    it("names the batch ceiling in the reason rather than in the sentence", async () => {
      const { hono, stub } = buildApi();

      const response = await send(hono, "POST", "/api/dataset/my-dataset/records", {
        entries: Array.from({ length: 1001 }, (_, index) => ({ input: `item-${index}` })),
      });

      expect(response.status).toBe(422);
      const body = (await response.json()) as {
        error: string;
        reasons: { meta: { field: string; message: string } }[];
      };
      expect(body.error).toBe("validation_error");
      expect(body.reasons[0]?.meta.field).toBe("entries");
      expect(body.reasons[0]?.meta.message).toMatch(/batch size|1000/i);
      expect(stub.batchCreateRecords).not.toHaveBeenCalled();
    });

    /**
     * @scenario "Batch create records validates column names against dataset schema"
     */
    it("answers 400 when an entry names a column the dataset does not have", async () => {
      const { hono } = buildApi({
        batchCreateRecords: vi.fn(async () => {
          throw domainError(
            "InvalidColumnError",
            'Invalid column "foo". Valid columns: input, output',
          );
        }),
      });

      const response = await send(hono, "POST", "/api/dataset/my-dataset/records", {
        entries: [{ input: "hi", foo: "bar" }],
      });

      expect(response.status).toBe(400);
      const body = (await response.json()) as { message: string };
      expect(body.message).toContain("foo");
      expect(body.message).toContain("input");
      expect(body.message).toContain("output");
    });

    it("answers 500 naming columnTypes when the dataset's own column list is malformed", async () => {
      const { hono } = buildApi({
        batchCreateRecords: vi.fn(async () => {
          throw domainError("MalformedColumnTypesError", "columnTypes is not an array");
        }),
      });

      const response = await send(hono, "POST", "/api/dataset/malformed-cols/records", {
        entries: [{ input: "hello" }],
      });

      expect(response.status).toBe(500);
      const body = (await response.json()) as { message: string };
      expect(body.message).toContain("columnTypes");
    });

    /**
     * @scenario "Batch create records returns 404 for non-existent dataset"
     */
    it("answers 404 when the dataset does not exist", async () => {
      const { hono } = buildApi({
        batchCreateRecords: vi.fn(async () => {
          throw domainError("DatasetNotFoundError", "no such dataset");
        }),
      });

      const response = await send(hono, "POST", "/api/dataset/ghost/records", {
        entries: [{ input: "hello" }],
      });

      expect(response.status).toBe(404);
    });
  });

  describe("when records are deleted in a batch", () => {
    /**
     * @scenario "Delete records in batch"
     */
    it("answers the count the application removed", async () => {
      const { hono, stub } = buildApi();

      const response = await send(hono, "DELETE", "/api/dataset/my-dataset/records", {
        recordIds: ["rec-1", "rec-2"],
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ deletedCount: 2 });
      expect(stub.deleteRecords).toHaveBeenCalledWith({
        slugOrId: "my-dataset",
        projectId: "project-1",
        recordIds: ["rec-1", "rec-2"],
      });
    });

    /**
     * @scenario "Delete records with no matching IDs returns 404"
     */
    it("answers 404 when none of the named ids matched", async () => {
      const { hono } = buildApi({ deleteRecords: vi.fn(async () => ({ count: 0 })) });

      const response = await send(hono, "DELETE", "/api/dataset/my-dataset/records", {
        recordIds: ["nonexistent"],
      });

      expect(response.status).toBe(404);
      const body = (await response.json()) as { message: string };
      expect(body.message).toContain("No matching records");
    });

    /**
     * @scenario "Delete records requires recordIds in body"
     */
    it("refuses a body that names no ids", async () => {
      const { hono, stub } = buildApi();

      const response = await send(hono, "DELETE", "/api/dataset/my-dataset/records", {});

      expect(response.status).toBe(422);
      expect(stub.deleteRecords).not.toHaveBeenCalled();
    });
  });
  describe("when the caller carries no usable credential", () => {
    /**
     * @scenario "Request without API key returns 401"
     * @scenario "Request with invalid API key returns 401"
     */
    it("refuses every dataset route before the application is reached", async () => {
      for (const [method, path] of [
        ["GET", "/api/dataset"],
        ["POST", "/api/dataset"],
        ["GET", "/api/dataset/my-dataset"],
        ["PATCH", "/api/dataset/my-dataset"],
        ["DELETE", "/api/dataset/my-dataset"],
        ["GET", "/api/dataset/my-dataset/records"],
      ] as const) {
        const { hono, stub } = buildApi({}, { refuse: true });

        const response = await send(hono, method, path, method === "GET" ? undefined : {});

        expect(response.status).toBe(401);
        expect(stub.listDatasets).not.toHaveBeenCalled();
        expect(stub.getDatasetWithRecords).not.toHaveBeenCalled();
      }
    });

    /**
     * @scenario "Upload without API key returns 401"
     * @scenario "Upload to existing without API key returns 401"
     */
    it("refuses both upload doors the same way", async () => {
      for (const path of ["/api/dataset/upload", "/api/dataset/some-dataset/upload"]) {
        const { hono } = buildApi({}, { refuse: true });

        const response = await hono.request(path, { method: "POST", body: new FormData() });

        expect(response.status).toBe(401);
      }
    });
  });

  describe("when the project owns no dataset yet", () => {
    /** @scenario "List datasets returns empty array for project with no datasets" */
    it("answers an empty page rather than a refusal", async () => {
      const { hono } = buildApi({
        listDatasets: vi.fn(async () => ({
          data: [],
          pagination: { page: 1, limit: 50, total: 0, totalPages: 0 },
        })),
      });

      const response = await hono.request("/api/dataset");

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        data: [],
        pagination: { page: 1, limit: 50, total: 0, totalPages: 0 },
      });
    });
  });

  describe("when a dataset is named by its id rather than its slug", () => {
    /**
     * @scenario "Get a dataset by id"
     * @scenario "Endpoints accept both slug and dataset ID"
     */
    it("hands the path segment to the application unchanged either way", async () => {
      const bySlug = buildApi();
      const slugResponse = await bySlug.hono.request("/api/dataset/my-data");
      const byId = buildApi();
      const idResponse = await byId.hono.request("/api/dataset/dataset_xyz");

      expect(bySlug.stub.getDatasetWithRecords).toHaveBeenCalledWith({
        slugOrId: "my-data",
        projectId: "project-1",
        limitMb: 25,
      });
      expect(byId.stub.getDatasetWithRecords).toHaveBeenCalledWith({
        slugOrId: "dataset_xyz",
        projectId: "project-1",
        limitMb: 25,
      });
      await expect(slugResponse.json()).resolves.toEqual(await idResponse.json());
    });

    /** @scenario "Batch create records accepts dataset ID as well as slug" */
    it("appends rows against the id the path named", async () => {
      const { hono, stub } = buildApi();

      const response = await send(hono, "POST", "/api/dataset/dataset_xyz/records", {
        entries: [{ input: "test" }],
      });

      expect(response.status).toBe(201);
      expect(stub.batchCreateRecords).toHaveBeenCalledWith({
        slugOrId: "dataset_xyz",
        projectId: "project-1",
        entries: [{ input: "test" }],
      });
    });
  });

  describe("when a dataset's name and column set are both patched", () => {
    /** @scenario "Update a dataset name and column types" */
    it("carries both through and answers with what the application wrote", async () => {
      const renamed = {
        ...dataset,
        name: "New Name",
        slug: "new-name",
        columnTypes: [{ name: "question", type: "string" }],
      };
      const { hono, stub } = buildApi({ upsertDataset: vi.fn(async () => renamed) });

      const response = await send(hono, "PATCH", "/api/dataset/old-name", {
        name: "New Name",
        columnTypes: [{ name: "question", type: "string" }],
      });

      expect(response.status).toBe(200);
      expect(stub.upsertDataset).toHaveBeenCalledWith({
        projectId: "project-1",
        slugOrId: "old-name",
        name: "New Name",
        columnTypes: [{ name: "question", type: "string" }],
      });
      await expect(response.json()).resolves.toMatchObject({
        name: "New Name",
        slug: "new-name",
        columnTypes: [{ name: "question", type: "string" }],
      });
    });

    /** @scenario "Update dataset does not enforce plan limits" */
    it("runs no allowance step, so a project at its ceiling still edits what it has", async () => {
      const { hono, chain } = buildApi();

      const response = await send(hono, "PATCH", "/api/dataset/existing", { name: "Updated Name" });

      expect(response.status).toBe(200);
      expect(chain.filter((step) => step.startsWith("ceiling:"))).toEqual([]);
    });
  });

  describe("when a dataset's records are paged without a window", () => {
    /** @scenario "List records with default pagination" */
    it("asks for the first page and echoes the application's count", async () => {
      const { hono, stub } = buildApi({
        listRecords: vi.fn(async () => ({
          data: [{ id: "rec-1", entry: { input: "hello" } }],
          pagination: { page: 1, limit: 50, total: 100, totalPages: 2 },
        })),
      });

      const response = await hono.request("/api/dataset/my-dataset/records");

      expect(response.status).toBe(200);
      expect(stub.listRecords).toHaveBeenCalledWith({
        slugOrId: "my-dataset",
        projectId: "project-1",
        page: 1,
        limit: 50,
      });
      await expect(response.json()).resolves.toMatchObject({
        pagination: { page: 1, limit: 50, total: 100 },
      });
    });
  });

  describe("when records are deleted from a dataset that does not exist", () => {
    /** @scenario "Delete records for non-existent dataset returns 404" */
    it("answers 404 rather than a count of nothing", async () => {
      const { hono } = buildApi({
        deleteRecords: vi.fn(async () => {
          throw domainError("DatasetNotFoundError", "no such dataset");
        }),
      });

      const response = await send(hono, "DELETE", "/api/dataset/ghost/records", {
        recordIds: ["rec-1"],
      });

      expect(response.status).toBe(404);
    });
  });

  describe("when a file is uploaded into an existing dataset", () => {
    /** @scenario "Upload without a file field returns 422" */
    it("refuses a multipart body carrying no file", async () => {
      const { hono, stub } = buildApi({ uploadToExistingDataset: vi.fn() });

      const response = await upload(hono, "/api/dataset/empty/upload", new FormData());

      expect(response.status).toBe(422);
      expect(stub.uploadToExistingDataset).not.toHaveBeenCalled();
    });

    /** @scenario "Upload to a non-existent dataset returns 404" */
    it("answers 404 when the dataset the path names is gone", async () => {
      const { hono } = buildApi({
        uploadToExistingDataset: vi.fn(async () => {
          throw domainError("DatasetNotFoundError", "no such dataset");
        }),
      });

      const response = await upload(
        hono,
        "/api/dataset/does-not-exist/upload",
        formWithFile("data.csv", "input\nhello\n"),
      );

      expect(response.status).toBe(404);
    });

    /**
     * @scenario "Upload an empty file returns 422"
     * @scenario "Upload with unsupported file format is rejected"
     */
    it("turns a refusal the caller can fix by sending a different file into a 422", async () => {
      for (const kind of ["empty_file", "unsupported_format"] as const) {
        const { hono } = buildApi({
          uploadToExistingDataset: vi.fn(async () => {
            throw new UploadValidationError("refused", kind);
          }),
        });

        const response = await upload(
          hono,
          "/api/dataset/any/upload",
          formWithFile("data.xlsx", "binary"),
        );

        expect(response.status).toBe(422);
      }
    });

    /**
     * @scenario "Upload exceeding row limit is rejected"
     * @scenario "Upload exceeding file size limit is rejected"
     * @scenario "Upload fails when file columns do not match dataset columns"
     */
    it("turns a refusal about the file's own shape or size into a 400", async () => {
      for (const kind of ["row_limit_exceeded", "file_too_large", "column_mismatch"] as const) {
        const { hono } = buildApi({
          uploadToExistingDataset: vi.fn(async () => {
            throw new UploadValidationError("refused", kind);
          }),
        });

        const response = await upload(
          hono,
          "/api/dataset/big/upload",
          formWithFile("data.csv", "input\nhello\n"),
        );

        expect(response.status).toBe(400);
      }
    });
  });

  describe("when a file is uploaded as a brand-new dataset", () => {
    /** @scenario "Create + upload requires a name field" */
    it("refuses a body that names nothing to call the dataset", async () => {
      const { hono, stub } = buildApi({ createDatasetFromUpload: vi.fn() });

      const response = await upload(
        hono,
        "/api/dataset/upload",
        formWithFile("data.csv", "question\n2+2\n"),
      );

      expect(response.status).toBe(422);
      expect(stub.createDatasetFromUpload).not.toHaveBeenCalled();
    });

    /** @scenario "Create + upload requires a file field" */
    it("refuses a body carrying a name and no file", async () => {
      const { hono, stub } = buildApi({ createDatasetFromUpload: vi.fn() });
      const form = new FormData();
      form.set("name", "No File");

      const response = await upload(hono, "/api/dataset/upload", form);

      expect(response.status).toBe(422);
      expect(stub.createDatasetFromUpload).not.toHaveBeenCalled();
    });

    /** @scenario "Create + upload fails when slug conflicts with existing dataset" */
    it("answers 409 when the name's slug is already taken", async () => {
      const { hono } = buildApi({
        createDatasetFromUpload: vi.fn(async () => {
          throw domainError("DatasetConflictError", "slug taken");
        }),
      });
      const form = formWithFile("data.csv", "question\n2+2\n");
      form.set("name", "Duplicate");

      const response = await upload(hono, "/api/dataset/upload", form);

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({ error: "Conflict" });
    });

    /** @scenario "Create + upload rejects file exceeding row limit" */
    it("answers 400 when the file carries more rows than the family accepts", async () => {
      const { hono } = buildApi({
        createDatasetFromUpload: vi.fn(async () => {
          throw new UploadValidationError("too many rows", "row_limit_exceeded");
        }),
      });
      const form = formWithFile("data.csv", "question\n2+2\n");
      form.set("name", "Too Big");

      const response = await upload(hono, "/api/dataset/upload", form);

      expect(response.status).toBe(400);
    });
  });
});
