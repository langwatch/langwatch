/**
 * The dataset tRPC wire, pinned: every procedure name, its kind, and the
 * permission the server binds to it. A rename here is a cache-key change in
 * every browser that calls it.
 *
 * The handlers are driven through the same seam a process mounts them on, so
 * the byte budgets and the null-for-missing reads each door owns are proven
 * here rather than inferred from the declaration alone.
 *
 * Spec: packages/api/specs/transport-declaration-split.feature.
 */

import type { AuthzPermission } from "@langwatch/authz-contract";
import type { TrpcProcedureFactory, TrpcRouterMount } from "@langwatch/api/trpc";
import {
  batchRecordTrpc,
  DatasetNotFoundError,
  DatasetNotReadyError,
  datasetRecordTrpc,
  datasetTrpc,
  type DatasetApi,
} from "@langwatch/dataset-contract";
import { describe, expect, it, vi } from "vitest";

import { completeDatasetApi } from "../../app/__tests__/dataset-api.fake.ts";
import { batchRecordTrpcTransport } from "../batch-record.trpc.ts";
import { datasetRecordTrpcTransport } from "../dataset-record.trpc.ts";
import { datasetTrpcTransport } from "../dataset.trpc.ts";

type Declaration = { router: TrpcRouterMount<never, never> };
type Handler = (args: {
  input: unknown;
  actor: { type: "user"; id: string };
  scope: null;
  signal: undefined;
}) => Promise<unknown>;

/** Mounts a declaration and keeps what each procedure asked for and bound. */
function mounted(
  declaration: Declaration,
  app: DatasetApi,
): {
  permissions: (AuthzPermission | object)[];
  handlers: Record<string, Handler>;
} {
  const permissions: (AuthzPermission | object)[] = [];
  const handlers: Record<string, Handler> = {};

  const runtime: TrpcProcedureFactory<object> = {
    procedure: ({ access, handle, procedure }) => {
      permissions.push(access.kind === "permission" ? access.permission : access);
      const name = procedure.slice(procedure.indexOf(".") + 1);
      handlers[name] = (args) =>
        Promise.resolve((handle as (given: unknown) => unknown)({ ...args, app }));

      return {};
    },
    router: (record) => record,
  };

  (declaration.router as unknown as (factory: TrpcProcedureFactory<object>, app: unknown) => void)(
    runtime,
    () => app,
  );

  return { permissions, handlers };
}

function callable(declaration: Declaration, app: DatasetApi): Record<string, Handler> {
  return mounted(declaration, app).handlers;
}

const invocation = {
  actor: { type: "user" as const, id: "user-1" },
  scope: null,
  signal: undefined,
};

describe("the dataset tRPC declaration", () => {
  describe("given the contract and the server it is bound to", () => {
    /**
     * @scenario "The server repeats nothing the contract said"
     * @scenario "The dataset transports move without changing who may call them"
     */
    it("keeps the dataset wire names, kinds and permissions", () => {
      const { permissions } = mounted(datasetTrpcTransport, completeDatasetApi());
      const table = Object.entries(datasetTrpc.members).map(([name, member], index) => [
        name,
        member.kind,
        permissions[index],
      ]);

      expect(table).toEqual([
        ["upsert", "mutation", "datasets:manage"],
        ["validateDatasetName", "query", "datasets:view"],
        ["getAll", "query", "datasets:view"],
        ["getById", "query", "datasets:view"],
        ["deleteById", "mutation", "datasets:delete"],
        ["updateMapping", "mutation", "datasets:update"],
        ["findNextName", "query", "datasets:view"],
        ["copy", "mutation", "datasets:create"],
      ]);
    });

    /**
     * @scenario "The server repeats nothing the contract said"
     * @scenario "The dataset transports move without changing who may call them"
     */
    it("keeps the datasetRecord wire names, kinds and permissions", () => {
      const { permissions } = mounted(datasetRecordTrpcTransport, completeDatasetApi());
      const table = Object.entries(datasetRecordTrpc.members).map(([name, member], index) => [
        name,
        member.kind,
        permissions[index],
      ]);

      expect(table).toEqual([
        ["create", "mutation", "datasets:create"],
        ["update", "mutation", "datasets:update"],
        ["getAll", "query", "datasets:view"],
        ["listPaginated", "query", "datasets:view"],
        ["download", "mutation", "datasets:view"],
        ["getHead", "query", "datasets:view"],
        ["deleteMany", "mutation", "datasets:delete"],
      ]);
    });

    /**
     * @scenario "The server repeats nothing the contract said"
     * @scenario "The dataset transports move without changing who may call them"
     */
    it("keeps the batchRecord wire names, kinds and permissions", () => {
      const { permissions } = mounted(batchRecordTrpcTransport, completeDatasetApi());
      const table = Object.entries(batchRecordTrpc.members).map(([name, member], index) => [
        name,
        member.kind,
        permissions[index],
      ]);

      expect(table).toEqual([
        ["getAllByexperimentIdGroup", "query", "workflows:view"],
        ["getAllByexperimentSlug", "query", "workflows:view"],
      ]);
    });
  });

  describe("when the caller names an experiment instead of a dataset name", () => {
    it("forwards the experiment id to the application", async () => {
      const upsertDataset = vi.fn(async () => ({}) as never);
      const handlers = callable(
        datasetTrpcTransport,
        completeDatasetApi({ upsertDataset: upsertDataset as never }),
      );

      await handlers.upsert!({
        ...invocation,
        input: { projectId: "project-1", experimentId: "experiment-1", columnTypes: [] },
      });

      expect(upsertDataset).toHaveBeenCalledWith(
        expect.objectContaining({ experimentId: "experiment-1", name: undefined }),
      );
    });
  });

  describe("when the dataset a read names is archived or missing", () => {
    it("reads as null rather than failing the page", async () => {
      const handlers = callable(
        datasetTrpcTransport,
        completeDatasetApi({
          getBySlugOrId: async () => {
            throw new DatasetNotFoundError();
          },
        }),
      );

      await expect(
        handlers.getById!({
          ...invocation,
          input: { projectId: "project-1", datasetId: "gone" },
        }),
      ).resolves.toBeNull();
    });

    it("reads a missing paged dataset as null so the editor can say so", async () => {
      const handlers = callable(
        datasetRecordTrpcTransport,
        completeDatasetApi({
          getDatasetPage: async () => {
            throw new DatasetNotFoundError();
          },
        }),
      );

      await expect(
        handlers.listPaginated!({
          ...invocation,
          input: { projectId: "project-1", datasetId: "gone", page: 1, limit: 50 },
        }),
      ).resolves.toBeNull();
    });
  });

  describe("when the dataset a record call names is still being prepared", () => {
    /** @scenario "A still-preparing dataset refuses record reads and writes" */
    it("lets the refusal through as a client precondition failure", async () => {
      const notReady = () => {
        throw new DatasetNotReadyError({ status: "processing" });
      };
      const handlers = callable(
        datasetRecordTrpcTransport,
        completeDatasetApi({
          getDatasetPage: notReady as never,
          batchCreateRecords: notReady as never,
        }),
      );
      const input = { projectId: "project-1", datasetId: "dataset-1" };

      await expect(
        handlers.listPaginated!({ ...invocation, input: { ...input, page: 1, limit: 50 } }),
      ).rejects.toMatchObject({ code: "dataset_not_ready", httpStatus: 425, fault: "customer" });

      await expect(
        handlers.create!({ ...invocation, input: { ...input, entries: [] } }),
      ).rejects.toMatchObject({ code: "dataset_not_ready", httpStatus: 425 });
    });
  });

  describe("when the editor reads a whole dataset", () => {
    it("reads under the editor's byte budget, and lifts it for a download", async () => {
      const getDatasetWithRecords = vi.fn(async () => ({
        dataset: { id: "dataset-1" },
        records: [],
        truncated: true,
      }));
      const handlers = callable(
        datasetRecordTrpcTransport,
        completeDatasetApi({ getDatasetWithRecords: getDatasetWithRecords as never }),
      );
      const input = { projectId: "project-1", datasetId: "dataset-1" };

      await expect(
        handlers.getAll!({ ...invocation, input }),
      ).resolves.toEqual({ id: "dataset-1", datasetRecords: [], truncated: true });
      expect(getDatasetWithRecords).toHaveBeenCalledWith({
        slugOrId: "dataset-1",
        projectId: "project-1",
        limitMb: 13,
      });

      await handlers.download!({ ...invocation, input });
      expect(getDatasetWithRecords).toHaveBeenLastCalledWith({
        slugOrId: "dataset-1",
        projectId: "project-1",
        limitMb: null,
      });
    });
  });

  describe("when a copy names a source project", () => {
    it("hands the caller's identity to the application, which probes the source", async () => {
      const copyDatasetForActor = vi.fn(async () => ({}) as never);
      const handlers = callable(
        datasetTrpcTransport,
        completeDatasetApi({ copyDatasetForActor: copyDatasetForActor as never }),
      );

      await handlers.copy!({
        ...invocation,
        input: {
          datasetId: "dataset-1",
          sourceProjectId: "project-source",
          projectId: "project-target",
        },
      });

      expect(copyDatasetForActor).toHaveBeenCalledWith({
        actorId: "user-1",
        sourceDatasetId: "dataset-1",
        sourceProjectId: "project-source",
        targetProjectId: "project-target",
      });
    });
  });
});
