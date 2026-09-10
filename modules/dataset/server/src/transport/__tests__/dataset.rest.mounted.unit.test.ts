/**
 * `/api/dataset`, driven as a mounted family: real requests through the REST
 * runtime, a stubbed application behind it. The declaration test beside this
 * one pins the addresses; this one pins what each door answers — the statuses,
 * the bodies and the refusals `specs/features/dataset-rest-api.feature`
 * promises integrators.
 *
 * The file-upload doors are absent on purpose: they need a multipart body the
 * runtime cannot declare yet, so `dataset-file-upload-api.feature`'s upload
 * scenarios stay unbound until it grows that door.
 */

import {
  bindRestMiddleware,
  createRestRuntime,
  projectRestFacts,
  UnauthorizedError,
  type PlatformUrlBuilder,
  type RestErrorHandler,
} from "@langwatch/api/rest";
import { completeDatasetApi } from "../../app/__tests__/dataset-api.fake.ts";
import { HandledError } from "@langwatch/handled-error";
import type { DatasetApi } from "@langwatch/dataset-contract";
import { describe, expect, it, vi } from "vitest";

import { createDatasetErrorHandler } from "../dataset-rest.errors.ts";
import { createDatasetRest } from "../dataset.rest.ts";

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

const platformUrl: PlatformUrlBuilder = ({ projectSlug, path }) =>
  `https://app.langwatch.test/${projectSlug}${path}`;

/**
 * A domain error as the application raises it: a plain `Error` whose NAME is
 * the discriminant the family's own `onError` reads.
 */
function domainError(name: string, message: string): Error {
  const error = new Error(message);
  error.name = name;

  return error;
}

/** The process boundary this family layers over, reduced to what it renders. */
const boundaryErrorHandler: RestErrorHandler = (error, c) => {
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

function mount(overrides: Partial<DatasetApi> = {}, options: { refuse?: boolean } = {}) {
  const stub = completeDatasetApi({
    listDatasets: vi.fn(async () => ({
      data: [{ ...dataset, recordCount: 2 }],
      pagination: { page: 1, limit: 50, total: 1, totalPages: 1 },
    })) as never,
    upsertDataset: vi.fn(async () => dataset) as never,
    getDatasetWithRecords: vi.fn(async () => ({
      dataset,
      records: [{ id: "rec-1", entry: { input: "hello" } }],
      truncated: false,
    })) as never,
    listRecords: vi.fn(async () => ({
      data: [{ id: "rec-1", entry: { input: "hello" } }],
      pagination: { page: 1, limit: 50, total: 1, totalPages: 1 },
    })) as never,
    batchCreateRecords: vi.fn(async () => [{ id: "rec-1", entry: { input: "hello" } }]) as never,
    deleteRecords: vi.fn(async () => ({ count: 2 })) as never,
    archiveDataset: vi.fn(async () => ({ id: "dataset_1", archived: true as const })) as never,
    ...overrides,
  });

  const runtime = createRestRuntime({
    identity: {
      authenticate: () => {
        if (options.refuse) throw new UnauthorizedError();

        return {
          actor: { type: "user" as const, id: "user-1" },
          scope: { tier: "project" as const, id: "project-1" },
        };
      },
    },
  });

  const hono = runtime.mount(createDatasetRest(platformUrl).router(), {
    app: () => stub,
    credential: "project",
    onError: createDatasetErrorHandler({ boundaryErrorHandler }),
    facts: [
      bindRestMiddleware(projectRestFacts, () => ({
        projectSlug: "project-one",
        viewerUserId: null,
        actorId: "user-1",
      })),
    ],
  });

  const send = (method: string, path: string, body?: unknown) =>
    hono.request(path, {
      method,
      ...(body === void 0
        ? {}
        : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    });

  return { send, stub };
}

describe("the mounted dataset REST family", () => {
  describe("when the project's datasets are listed", () => {
    /** @scenario "List datasets with page and limit parameters" */
    it("passes the page window through and links each row into the platform", async () => {
      const { send, stub } = mount();

      const response = await send("GET", "/api/dataset?page=2&limit=5");

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
            slug: "my-dataset",
            recordCount: 2,
            platformUrl: "https://app.langwatch.test/project-one/datasets/dataset_1",
          },
        ],
        pagination: { page: 1, limit: 50, total: 1, totalPages: 1 },
      });
    });

    /** @scenario "List datasets returns empty array for project with no datasets" */
    it("answers an empty page rather than a refusal", async () => {
      const { send } = mount({
        listDatasets: vi.fn(async () => ({
          data: [],
          pagination: { page: 1, limit: 50, total: 0, totalPages: 0 },
        })) as never,
      });

      const response = await send("GET", "/api/dataset");

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        data: [],
        pagination: { page: 1, limit: 50, total: 0, totalPages: 0 },
      });
    });
  });

  describe("when a dataset is created", () => {
    it("answers 201 with the row and its link", async () => {
      const { send, stub } = mount();

      const response = await send("POST", "/api/dataset", {
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

    /** @scenario "Create a dataset requires a name" */
    it("refuses a body with no name", async () => {
      const { send, stub } = mount();

      const response = await send("POST", "/api/dataset", {
        columnTypes: [{ name: "input", type: "string" }],
      });

      expect(response.status).toBe(422);
      expect(stub.upsertDataset).not.toHaveBeenCalled();
    });

    /** @scenario "Create a dataset validates column types" */
    it("refuses a column whose type is not one the dataset understands", async () => {
      const { send, stub } = mount();

      const response = await send("POST", "/api/dataset", {
        name: "Bad Types",
        columnTypes: [{ name: "col1", type: "invalid_type" }],
      });

      expect(response.status).toBe(422);
      expect(stub.upsertDataset).not.toHaveBeenCalled();
    });

    /** @scenario "Create a dataset auto-generates a unique slug from the name" */
    it("answers 409 when the slug the name produces is already taken", async () => {
      const { send } = mount({
        upsertDataset: vi.fn(async () => {
          throw domainError("DatasetConflictError", "slug taken");
        }) as never,
      });

      const response = await send("POST", "/api/dataset", { name: "Test Data" });

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({ error: "Conflict" });
    });
  });

  describe("when one dataset is read whole", () => {
    /**
     * @scenario "Get a dataset by slug"
     * @scenario "Get a dataset by id"
     * @scenario "Endpoints accept both slug and dataset ID"
     */
    it("hands the path segment to the application unchanged, slug or id", async () => {
      const bySlug = mount();
      const slugResponse = await bySlug.send("GET", "/api/dataset/my-data");
      const byId = mount();
      const idResponse = await byId.send("GET", "/api/dataset/dataset_xyz");

      expect(slugResponse.status).toBe(200);
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

    /** @scenario "Get dataset enforces 25MB response size limit" */
    it("refuses rather than truncating when the read exceeds that ceiling", async () => {
      const { send } = mount({
        getDatasetWithRecords: vi.fn(async () => ({
          dataset,
          records: [],
          truncated: true,
        })) as never,
      });

      const response = await send("GET", "/api/dataset/large-dataset");

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        message: expect.stringContaining("25MB limit"),
      });
    });

    /** @scenario "Get dataset returns 404 for non-existent slug" */
    it("answers 404 for a slug that names no dataset", async () => {
      const { send } = mount({
        getDatasetWithRecords: vi.fn(async () => {
          throw domainError("DatasetNotFoundError", "no such dataset");
        }) as never,
      });

      expect((await send("GET", "/api/dataset/does-not-exist")).status).toBe(404);
    });

    it("answers 425 with the lifecycle state while the dataset is still preparing", async () => {
      const { send } = mount({
        getDatasetWithRecords: vi.fn(async () => {
          throw domainError("DatasetNotReadyError", "still preparing");
        }) as never,
      });

      const response = await send("GET", "/api/dataset/still-preparing");

      expect(response.status).toBe(425);
      await expect(response.json()).resolves.toMatchObject({ error: "DatasetNotReady" });
    });
  });

  describe("when a dataset is patched", () => {
    /** @scenario "Update a dataset name and column types" */
    it("carries both through and answers with what the application wrote", async () => {
      const renamed = {
        ...dataset,
        name: "New Name",
        slug: "new-name",
        columnTypes: [{ name: "question", type: "string" }],
      };
      const { send, stub } = mount({ upsertDataset: vi.fn(async () => renamed) as never });

      const response = await send("PATCH", "/api/dataset/old-name", {
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
      const { send } = mount();

      // The route declares `datasets:manage` and nothing else; an allowance
      // check would be a second declared step, and there is none to run.
      expect((await send("PATCH", "/api/dataset/existing", { name: "Updated Name" })).status).toBe(
        200,
      );
    });

    /** @scenario "Update a dataset fails when new slug conflicts" */
    it("answers 409 when the new name collides with another dataset", async () => {
      const { send } = mount({
        upsertDataset: vi.fn(async () => {
          throw domainError("DatasetConflictError", "slug taken");
        }) as never,
      });

      expect((await send("PATCH", "/api/dataset/alpha", { name: "Beta" })).status).toBe(409);
    });

    /** @scenario "Update a non-existent dataset returns 404" */
    it("answers 404 when the project has no such dataset", async () => {
      const { send } = mount({
        upsertDataset: vi.fn(async () => {
          throw domainError("DatasetNotFoundError", "no such dataset");
        }) as never,
      });

      expect((await send("PATCH", "/api/dataset/ghost", { name: "Whatever" })).status).toBe(404);
    });
  });

  describe("when a dataset is archived", () => {
    it("answers what the application archived", async () => {
      const { send, stub } = mount();

      const response = await send("DELETE", "/api/dataset/to-delete");

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ id: "dataset_1", archived: true });
      expect(stub.archiveDataset).toHaveBeenCalledWith({
        slugOrId: "to-delete",
        projectId: "project-1",
      });
    });

    /** @scenario "Delete a non-existent dataset returns 404" */
    it("answers 404 for a slug that names no dataset", async () => {
      const { send } = mount({
        archiveDataset: vi.fn(async () => {
          throw domainError("DatasetNotFoundError", "no such dataset");
        }) as never,
      });

      expect((await send("DELETE", "/api/dataset/nope")).status).toBe(404);
    });
  });

  describe("when a dataset's records are paged", () => {
    /** @scenario "List records with default pagination" */
    it("asks for the first page and echoes the application's count", async () => {
      const { send, stub } = mount({
        listRecords: vi.fn(async () => ({
          data: [{ id: "rec-1", entry: { input: "hello" } }],
          pagination: { page: 1, limit: 50, total: 100, totalPages: 2 },
        })) as never,
      });

      const response = await send("GET", "/api/dataset/my-dataset/records");

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

    it("passes a named page window through", async () => {
      const { send, stub } = mount();

      expect((await send("GET", "/api/dataset/my-dataset/records?page=3&limit=20")).status).toBe(
        200,
      );
      expect(stub.listRecords).toHaveBeenCalledWith({
        slugOrId: "my-dataset",
        projectId: "project-1",
        page: 3,
        limit: 20,
      });
    });

    /** @scenario "List records for non-existent dataset returns 404" */
    it("answers 404 for a dataset that does not exist", async () => {
      const { send } = mount({
        listRecords: vi.fn(async () => {
          throw domainError("DatasetNotFoundError", "no such dataset");
        }) as never,
      });

      expect((await send("GET", "/api/dataset/ghost/records")).status).toBe(404);
    });
  });

  describe("when records are appended in a batch", () => {
    /**
     * @scenario "Batch create records via POST /:slugOrId/records"
     * @scenario "Batch create records accepts dataset ID as well as slug"
     */
    it("answers 201 with the rows it created, under a slug or an id", async () => {
      const { send, stub } = mount();

      const response = await send("POST", "/api/dataset/my-dataset/records", {
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

      const byId = mount();
      expect(
        (await byId.send("POST", "/api/dataset/dataset_xyz/records", { entries: [{ input: "x" }] }))
          .status,
      ).toBe(201);
      expect(byId.stub.batchCreateRecords).toHaveBeenCalledWith({
        slugOrId: "dataset_xyz",
        projectId: "project-1",
        entries: [{ input: "x" }],
      });
    });

    /** @scenario "Batch create records requires entries in body" */
    it("refuses a body with no entries", async () => {
      const { send, stub } = mount();

      expect((await send("POST", "/api/dataset/my-dataset/records", {})).status).toBe(422);
      expect(stub.batchCreateRecords).not.toHaveBeenCalled();
    });

    /** @scenario "Batch create records enforces maximum batch size" */
    it("names the batch ceiling in the reason rather than in the sentence", async () => {
      const { send, stub } = mount();

      const response = await send("POST", "/api/dataset/my-dataset/records", {
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

    /** @scenario "Batch create records validates column names against dataset schema" */
    it("answers 400 when an entry names a column the dataset does not have", async () => {
      const { send } = mount({
        batchCreateRecords: vi.fn(async () => {
          throw domainError(
            "InvalidColumnError",
            'Invalid column "foo". Valid columns: input, output',
          );
        }) as never,
      });

      const response = await send("POST", "/api/dataset/my-dataset/records", {
        entries: [{ input: "hi", foo: "bar" }],
      });

      expect(response.status).toBe(400);
      const body = (await response.json()) as { message: string };
      expect(body.message).toContain("foo");
      expect(body.message).toContain("input");
      expect(body.message).toContain("output");
    });

    it("answers 500 naming columnTypes when the dataset's own column list is malformed", async () => {
      const { send } = mount({
        batchCreateRecords: vi.fn(async () => {
          throw domainError("MalformedColumnTypesError", "columnTypes is not an array");
        }) as never,
      });

      const response = await send("POST", "/api/dataset/malformed-cols/records", {
        entries: [{ input: "hello" }],
      });

      expect(response.status).toBe(500);
      const body = (await response.json()) as { message: string };
      expect(body.message).toContain("columnTypes");
    });

    /** @scenario "Batch create records returns 404 for non-existent dataset" */
    it("answers 404 when the dataset does not exist", async () => {
      const { send } = mount({
        batchCreateRecords: vi.fn(async () => {
          throw domainError("DatasetNotFoundError", "no such dataset");
        }) as never,
      });

      expect(
        (await send("POST", "/api/dataset/ghost/records", { entries: [{ input: "hello" }] })).status,
      ).toBe(404);
    });
  });

  describe("when records are deleted in a batch", () => {
    /** @scenario "Delete records in batch" */
    it("answers the count the application removed", async () => {
      const { send, stub } = mount();

      const response = await send("DELETE", "/api/dataset/my-dataset/records", {
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

    /** @scenario "Delete records with no matching IDs returns 404" */
    it("answers 404 when none of the named ids matched", async () => {
      const { send } = mount({ deleteRecords: vi.fn(async () => ({ count: 0 })) as never });

      const response = await send("DELETE", "/api/dataset/my-dataset/records", {
        recordIds: ["nonexistent"],
      });

      expect(response.status).toBe(404);
      const body = (await response.json()) as { message: string };
      expect(body.message).toContain("No matching records");
    });

    /** @scenario "Delete records for non-existent dataset returns 404" */
    it("answers 404 rather than a count of nothing", async () => {
      const { send } = mount({
        deleteRecords: vi.fn(async () => {
          throw domainError("DatasetNotFoundError", "no such dataset");
        }) as never,
      });

      expect(
        (await send("DELETE", "/api/dataset/ghost/records", { recordIds: ["rec-1"] })).status,
      ).toBe(404);
    });

    /** @scenario "Delete records requires recordIds in body" */
    it("refuses a body that names no ids", async () => {
      const { send, stub } = mount();

      expect((await send("DELETE", "/api/dataset/my-dataset/records", {})).status).toBe(422);
      expect(stub.deleteRecords).not.toHaveBeenCalled();
    });
  });

  describe("when the caller carries no usable credential", () => {
    /**
     * @scenario "Request without API key returns 401"
     * @scenario "Request with invalid API key returns 401"
     */
    it("refuses every dataset route before the application is reached", async () => {
      // Bodies are the ones each door accepts: the runtime parses before it
      // resolves the credential, so an invalid body would answer 422 and prove
      // nothing about the door.
      for (const [method, path, body] of [
        ["GET", "/api/dataset", void 0],
        ["POST", "/api/dataset", { name: "New" }],
        ["GET", "/api/dataset/my-dataset", void 0],
        ["PATCH", "/api/dataset/my-dataset", { name: "Renamed" }],
        ["DELETE", "/api/dataset/my-dataset", void 0],
        ["GET", "/api/dataset/my-dataset/records", void 0],
      ] as const) {
        const { send, stub } = mount({}, { refuse: true });

        const response = await send(method, path, body);

        expect(response.status).toBe(401);
        expect(stub.listDatasets).not.toHaveBeenCalled();
        expect(stub.getDatasetWithRecords).not.toHaveBeenCalled();
      }
    });
  });
});
