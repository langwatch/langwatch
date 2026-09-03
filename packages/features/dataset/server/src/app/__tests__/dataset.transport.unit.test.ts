/**
 * @vitest-environment node
 *
 * The `/api/dataset` door: the permission each route declares, the request
 * schemas it refuses a body against, the statuses it makes out of the
 * application's domain errors, and the wire shapes it answers with.
 *
 * Ported from `platform/app/src/app/api/dataset/__tests__/dataset-rest-api.integration.test.ts`
 * and `dataset-upload-api.integration.test.ts`, both of which drove this family
 * against Postgres. Everything those files proved about the SERVICE — slug
 * generation, archive semantics, CSV/JSONL parsing, column inference, type
 * coercion, real record counts — needs a datastore and stays where the service
 * is exercised; see the port report for the list. What was proved about the
 * DOOR and about nothing else is here.
 *
 * The application is stubbed. This file asserts what the transport does, never
 * what the domain decides.
 */
import {
  createAppRestSecurity,
  getRoutePolicy,
  type AppRestSecurity,
  type RestApiServicePorts,
} from "@langwatch/api/rest";
import { HandledError } from "@langwatch/handled-error";
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
function testSecurity(): { security: AppRestSecurity; chain: string[] } {
  const chain: string[] = [];
  const record =
    (label: string): MiddlewareHandler =>
    async (_c, next) => {
      chain.push(label);
      await next();
    };
  const authenticateProject: MiddlewareHandler = async (c, next) => {
    chain.push("authenticateProject");
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
    authorizeRouteProjectPermission: ({ permission }) =>
      record(`authorizeRouteProject:${permission}`),
    authenticateOrganizationThrowing: record("authenticateOrganizationThrowing"),
    authorizeOrganizationPermissionThrowing: (permission) =>
      record(`authorizeOrgThrowing:${permission}`),
  };

  return { security: createAppRestSecurity(ports), chain };
}

function buildApi(overrides: Record<string, unknown> = {}) {
  const { security, chain } = testSecurity();
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

    it("refuses a body with no name", async () => {
      const { hono, stub } = buildApi();

      const response = await send(hono, "POST", "/api/dataset", {
        columnTypes: [{ name: "input", type: "string" }],
      });

      expect(response.status).toBe(422);
      expect(stub.upsertDataset).not.toHaveBeenCalled();
    });

    it("refuses a column whose type is not one the dataset understands", async () => {
      const { hono, stub } = buildApi();

      const response = await send(hono, "POST", "/api/dataset", {
        name: "Bad Types",
        columnTypes: [{ name: "col1", type: "invalid_type" }],
      });

      expect(response.status).toBe(422);
      expect(stub.upsertDataset).not.toHaveBeenCalled();
    });

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

    it("answers 409 when the new name collides with another dataset", async () => {
      const { hono } = buildApi({
        upsertDataset: vi.fn(async () => {
          throw domainError("DatasetConflictError", "slug taken");
        }),
      });

      const response = await send(hono, "PATCH", "/api/dataset/alpha", { name: "Beta" });

      expect(response.status).toBe(409);
    });

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

    it("refuses a body with no entries", async () => {
      const { hono, stub } = buildApi();

      const response = await send(hono, "POST", "/api/dataset/my-dataset/records", {});

      expect(response.status).toBe(422);
      expect(stub.batchCreateRecords).not.toHaveBeenCalled();
    });

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

    it("answers 404 when none of the named ids matched", async () => {
      const { hono } = buildApi({ deleteRecords: vi.fn(async () => ({ count: 0 })) });

      const response = await send(hono, "DELETE", "/api/dataset/my-dataset/records", {
        recordIds: ["nonexistent"],
      });

      expect(response.status).toBe(404);
      const body = (await response.json()) as { message: string };
      expect(body.message).toContain("No matching records");
    });

    it("refuses a body that names no ids", async () => {
      const { hono, stub } = buildApi();

      const response = await send(hono, "DELETE", "/api/dataset/my-dataset/records", {});

      expect(response.status).toBe(422);
      expect(stub.deleteRecords).not.toHaveBeenCalled();
    });
  });
});
