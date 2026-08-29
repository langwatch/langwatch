/**
 * @vitest-environment node
 *
 * The `datasetRecord.*` tRPC surface itself: the seven procedure names the
 * editor calls, the permission declared on each, and the 4xx each domain
 * failure maps to. That mapping is the contract the editor branches on — a
 * still-preparing dataset, an over-cap export, an over-cap cell edit and a
 * duplicate row id are all client-side preconditions, and every one of them
 * used to reach the customer as an unknown 500.
 *
 * `sees the parsed input` is the load-bearing one: the host's authorization
 * check, scope-lineage guard and audit row are installed by the policy THIS
 * file injects, and a policy composed ahead of `.input()` receives
 * `input === undefined` while all three still report green.
 */
import {
  ChunkTooLargeError,
  DatasetNotFoundError,
  DatasetNotReadyError,
  DatasetTooLargeToExportError,
  DuplicateRecordIdError,
  type DatasetService,
} from "@langwatch/dataset-contract";
import { initTRPC } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";

import { DatasetRecordTrpcApi } from "../src/transport/api-trpc/dataset-record.api";
import { DatasetApp } from "../src/app/dataset.app";

type TestContext = { app: { dataset: DatasetApp } };

type PolicyCall = { permission: string; path: string; input: unknown };

/** This surface makes no experiment read; the lookups refuse if one appears. */
const noExperiments = {
  getById: async () => {
    throw new Error("the record surface reads no experiment");
  },
  tryGetBySlug: async () => {
    throw new Error("the record surface reads no experiment");
  },
};

function harness(dataset: Partial<DatasetService> = {}) {
  const policyCalls: PolicyCall[] = [];
  const declaredPermissions: string[] = [];

  const trpc = initTRPC.context<TestContext>().create();
  const policy = (permission: string) => {
    declaredPermissions.push(permission);
    return <TProcedure>(procedure: TProcedure): TProcedure =>
      (procedure as any).use(async (opts: any) => {
        policyCalls.push({ permission, path: opts.path, input: opts.input });
        return opts.next();
      }) as TProcedure;
  };

  const router = DatasetRecordTrpcApi.create(trpc, {
    protected: trpc.procedure,
    policy: policy as never,
  });

  return {
    router,
    policyCalls,
    declaredPermissions,
    caller: router.createCaller({
      app: {
        dataset: DatasetApp.create({
          dataset: dataset as DatasetService,
          experiments: noExperiments,
        }),
      },
    }),
  };
}

const lookup = { projectId: "project-1", datasetId: "dataset-1" };

describe("DatasetRecordTrpcApi", () => {
  describe("given the mounted router", () => {
    it("exposes exactly the procedure names the editor calls", () => {
      const { router } = harness();

      expect(Object.keys(router._def.procedures)).toEqual([
        "create",
        "update",
        "getAll",
        "listPaginated",
        "download",
        "getHead",
        "deleteMany",
      ]);
    });

    it("declares the same permission on each procedure as before the move", () => {
      const { router, declaredPermissions } = harness();

      expect(
        Object.fromEntries(
          Object.keys(router._def.procedures).map((path, index) => [
            path,
            declaredPermissions[index],
          ]),
        ),
      ).toEqual({
        create: "datasets:create",
        update: "datasets:update",
        getAll: "datasets:view",
        listPaginated: "datasets:view",
        download: "datasets:view",
        getHead: "datasets:view",
        deleteMany: "datasets:delete",
      });
    });
  });

  describe("when a procedure with defaulted input runs", () => {
    /** @scenario "The declared check reads the validated input" */
    it("hands the host policy the parsed input, defaults filled in", async () => {
      const { caller, policyCalls } = harness({
        getDatasetPage: async () => ({ id: "dataset-1" }) as never,
      });

      await caller.listPaginated(lookup);

      expect(policyCalls).toEqual([
        {
          permission: "datasets:view",
          path: "listPaginated",
          input: { ...lookup, page: 1, limit: 50 },
        },
      ]);
    });
  });

  describe("when the dataset is still preparing", () => {
    /** @scenario "A still-preparing dataset refuses record reads and writes" */
    it("refuses every read and write with PRECONDITION_FAILED, not a 500", async () => {
      const notReady = () => {
        throw new DatasetNotReadyError({ status: "processing" });
      };
      const { caller } = harness({
        batchCreateRecords: notReady,
        upsertRecord: notReady,
        getDatasetWithRecords: notReady,
        getDatasetPage: notReady,
        getDatasetHead: notReady,
        deleteRecords: notReady,
      });

      const refusals = await Promise.all(
        [
          caller.create({ ...lookup, entries: [] }),
          caller.update({ ...lookup, recordId: "record-1", updatedRecord: {} }),
          caller.getAll(lookup),
          caller.listPaginated(lookup),
          caller.download(lookup),
          caller.getHead(lookup),
          caller.deleteMany({ ...lookup, recordIds: ["record-1"] }),
        ].map((call) => call.then(() => null).catch((error: { code?: string }) => error.code)),
      );

      expect(refusals).toEqual(Array.from({ length: 7 }, () => "PRECONDITION_FAILED"));
    });
  });

  describe("when a write or export exceeds a cap", () => {
    it("maps an over-cap export to PAYLOAD_TOO_LARGE", async () => {
      const { caller } = harness({
        getDatasetWithRecords: () => {
          throw new DatasetTooLargeToExportError("too large");
        },
      });

      await expect(caller.download(lookup)).rejects.toMatchObject({
        code: "PAYLOAD_TOO_LARGE",
      });
    });

    it("maps an over-cap cell edit to BAD_REQUEST", async () => {
      const { caller } = harness({
        upsertRecord: () => {
          throw new ChunkTooLargeError("chunk too large");
        },
      });

      await expect(
        caller.update({ ...lookup, recordId: "record-1", updatedRecord: {} }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("maps a duplicate caller-supplied row id to CONFLICT", async () => {
      const { caller } = harness({
        batchCreateRecords: () => {
          throw new DuplicateRecordIdError("duplicate id");
        },
      });

      await expect(caller.create({ ...lookup, entries: [] })).rejects.toMatchObject({
        code: "CONFLICT",
      });
    });
  });

  describe("when the dataset a paged read names is archived or missing", () => {
    it("reads as null so the editor can say it is no longer available", async () => {
      const { caller } = harness({
        getDatasetPage: () => {
          throw new DatasetNotFoundError("gone");
        },
      });

      await expect(caller.listPaginated(lookup)).resolves.toBeNull();
    });
  });

  describe("when the editor reads a whole dataset", () => {
    it("reads under the editor's byte budget and reports truncation", async () => {
      const getDatasetWithRecords = vi.fn(async () => ({
        dataset: { id: "dataset-1", name: "Fixtures" },
        records: [{ id: "record-1" }],
        truncated: true,
      })) as unknown as DatasetService["getDatasetWithRecords"];
      const { caller } = harness({ getDatasetWithRecords });

      await expect(caller.getAll(lookup)).resolves.toEqual({
        id: "dataset-1",
        name: "Fixtures",
        datasetRecords: [{ id: "record-1" }],
        truncated: true,
      });
      expect(getDatasetWithRecords).toHaveBeenCalledWith({
        slugOrId: "dataset-1",
        projectId: "project-1",
        limitMb: 13,
      });
    });

    it("lifts the byte budget for a download", async () => {
      const getDatasetWithRecords = vi.fn(async () => ({
        dataset: { id: "dataset-1" },
        records: [],
        truncated: false,
      })) as unknown as DatasetService["getDatasetWithRecords"];
      const { caller } = harness({ getDatasetWithRecords });

      await caller.download(lookup);

      expect(getDatasetWithRecords).toHaveBeenCalledWith({
        slugOrId: "dataset-1",
        projectId: "project-1",
        limitMb: null,
      });
    });
  });
});
