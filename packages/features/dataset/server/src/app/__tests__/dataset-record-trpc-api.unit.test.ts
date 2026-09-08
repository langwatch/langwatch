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
import type { DatasetService } from "@langwatch/dataset-contract";
import {
  ChunkTooLargeError,
  DatasetNotFoundError,
  DatasetNotReadyError,
  DatasetTooLargeToExportError,
  DuplicateRecordIdError,
} from "@langwatch/dataset-contract";
import { initTRPC } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";

import { DatasetRecordTrpcApi } from "../../transport/api-trpc/dataset-record.api.ts";
import { DatasetApp } from "../dataset.app.ts";
import { UnavailableDatasetAttachmentStore } from "../../adapters/unavailable-dataset-attachment-store.adapter.ts";
import { DatasetAttachmentService } from "../../services/dataset-attachment.service.ts";
import type { DatasetAttachmentStorePort } from "../../ports/dataset-attachment-store.port.ts";

/** These surfaces upload nothing: the store refuses if an upload ever appears. */
function noAttachments(): DatasetAttachmentService {
  return DatasetAttachmentService.create({ store: UnavailableDatasetAttachmentStore.create() });
}

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

function harness({
  dataset = {},
  attachments,
}: {
  dataset?: Partial<DatasetService>;
  attachments?: DatasetAttachmentService;
} = {}) {
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
    // This suite's fixtures are deliberately partial (only the fields each
    // assertion reads) across seven procedures with distinct strict output
    // schemas; validating every handler's answer here would mean fully
    // hydrating every stub rather than testing what this file is for — the
    // procedure names, the declared permissions and the domain-error-to-4xx
    // mapping.
    validateOutput: false,
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
          attachments: attachments ?? noAttachments(),
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
        "uploadAttachment",
      ]);
    });

    /** @scenario "The upload is allowed to a person who may edit the dataset" */
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
        uploadAttachment: "datasets:update",
      });
    });
  });

  describe("when a procedure with defaulted input runs", () => {
    /** @scenario "The declared check reads the validated input" */
    it("hands the host policy the parsed input, defaults filled in", async () => {
      const { caller, policyCalls } = harness({
        dataset: {
          getDatasetPage: async () => ({ id: "dataset-1" }) as never,
        },
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

  describe("when a person uploads a file into a cell", () => {
    /** @scenario "An uploaded file is kept and the cell gets a reference to it" */
    it("answers with the reference the cell writes", async () => {
      const storeFromBytes = vi.fn(async () => ({
        id: "so_1",
        mediaType: "image/png",
        isDuplicate: false,
      }));
      const { caller } = harness({
        attachments: DatasetAttachmentService.create({
          store: { storeFromBytes } as unknown as DatasetAttachmentStorePort,
        }),
      });

      const attachment = await caller.uploadAttachment({
        projectId: "project-1",
        fileName: "photo.png",
        dataUrl: `data:image/png;base64,${Buffer.from("a tiny picture").toString("base64")}`,
      });

      expect(attachment.url).toBe("/api/files/project-1/so_1");
      expect(storeFromBytes).toHaveBeenCalledWith(
        expect.objectContaining({ purpose: "dataset_attachment" }),
      );
    });
  });

  describe("when the dataset is still preparing", () => {
    /** @scenario "A still-preparing dataset refuses record reads and writes" */
    it("refuses every read and write with PRECONDITION_FAILED, not a 500", async () => {
      const notReady = () => {
        throw new DatasetNotReadyError({ status: "processing" });
      };
      const { caller } = harness({
        dataset: {
          batchCreateRecords: notReady,
          upsertRecord: notReady,
          getDatasetWithRecords: notReady,
          getDatasetPage: notReady,
          getDatasetHead: notReady,
          deleteRecords: notReady,
        },
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
        dataset: {
          getDatasetWithRecords: () => {
            throw new DatasetTooLargeToExportError({ sizeBytes: 2, maxBytes: 1 });
          },
        },
      });

      await expect(caller.download(lookup)).rejects.toMatchObject({
        code: "PAYLOAD_TOO_LARGE",
      });
    });

    it("maps an over-cap cell edit to BAD_REQUEST", async () => {
      const { caller } = harness({
        dataset: {
          upsertRecord: () => {
            throw new ChunkTooLargeError({ byteSize: 2, maxBytes: 1 });
          },
        },
      });

      await expect(
        caller.update({ ...lookup, recordId: "record-1", updatedRecord: {} }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("maps a duplicate caller-supplied row id to CONFLICT", async () => {
      const { caller } = harness({
        dataset: {
          batchCreateRecords: () => {
            throw new DuplicateRecordIdError("record-1");
          },
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
        dataset: {
          getDatasetPage: () => {
            throw new DatasetNotFoundError("gone");
          },
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
      const { caller } = harness({ dataset: { getDatasetWithRecords } });

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
      const { caller } = harness({ dataset: { getDatasetWithRecords } });

      await caller.download(lookup);

      expect(getDatasetWithRecords).toHaveBeenCalledWith({
        slugOrId: "dataset-1",
        projectId: "project-1",
        limitMb: null,
      });
    });
  });
});
