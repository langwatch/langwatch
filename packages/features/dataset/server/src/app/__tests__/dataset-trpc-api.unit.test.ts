/**
 * @vitest-environment node
 *
 * The `dataset.*` tRPC surface itself: the eight procedure names the clients
 * call, the permission declared on each, the domain-error translation the
 * clients branch on, and the source-project probe `copy` runs before it reads
 * anything.
 *
 * The load-bearing assertion is `sees the parsed input`. The host's policy —
 * the authorization check, the scope-lineage guard and the audit row — is
 * installed by THIS file, and tRPC appends the input parser at the point
 * `.input()` is called: a policy composed ahead of it receives
 * `input === undefined`, and every one of those three then silently passes
 * while reporting green.
 */
import { type DatasetService } from "@langwatch/dataset-contract";
import { DatasetConflictError, DatasetNotFoundError } from "../../services/errors";
import { initTRPC, TRPCError } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";

import { DatasetTrpcApi } from "../../transport/api-trpc/dataset.api";
import { DatasetApp } from "../dataset.app";

type TestContext = { app: { dataset: DatasetApp } };

type PolicyCall = { permission: string; path: string; input: unknown };

function datasetStub(overrides: Partial<DatasetService>): DatasetService {
  return overrides as DatasetService;
}

function harness({
  dataset = {} as Partial<DatasetService>,
  experimentName = "Borrowed name" as string | null,
  sourcePermitted = true,
}: {
  dataset?: Partial<DatasetService>;
  experimentName?: string | null;
  sourcePermitted?: boolean;
} = {}) {
  const policyCalls: PolicyCall[] = [];
  const declaredPermissions: string[] = [];
  const probeProjectPermission = vi.fn(async () => sourcePermitted);
  const getById = vi.fn(async () => ({ name: experimentName }));

  const trpc = initTRPC.context<TestContext>().create();
  const policy = (permission: string) => {
    declaredPermissions.push(permission);
    return <TProcedure>(procedure: TProcedure): TProcedure =>
      (procedure as any).use(async (opts: any) => {
        policyCalls.push({ permission, path: opts.path, input: opts.input });
        return opts.next();
      }) as TProcedure;
  };

  const router = DatasetTrpcApi.create(
    trpc,
    { protected: trpc.procedure, policy: policy as never },
    { probeProjectPermission },
  );

  return {
    router,
    policyCalls,
    declaredPermissions,
    probeProjectPermission,
    getById,
    caller: router.createCaller({
      app: {
        dataset: DatasetApp.create({
          dataset: datasetStub(dataset),
          experiments: {
            getById,
            tryGetBySlug: async () => {
              throw new Error("the dataset surface reads no experiment by slug");
            },
          },
        }),
      },
    }),
  };
}

describe("DatasetTrpcApi", () => {
  describe("given the mounted router", () => {
    it("exposes exactly the procedure names the clients call", () => {
      const { router } = harness();

      expect(Object.keys(router._def.procedures)).toEqual([
        "upsert",
        "validateDatasetName",
        "getAll",
        "getById",
        "deleteById",
        "updateMapping",
        "findNextName",
        "copy",
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
        upsert: "datasets:manage",
        validateDatasetName: "datasets:view",
        getAll: "datasets:view",
        getById: "datasets:view",
        deleteById: "datasets:delete",
        updateMapping: "datasets:update",
        findNextName: "datasets:view",
        copy: "datasets:create",
      });
    });
  });

  describe("when a procedure runs", () => {
    /** @scenario "The declared check reads the validated input" */
    it("hands the host policy the parsed input, not undefined", async () => {
      const { caller, policyCalls } = harness({
        dataset: { listDatasets: async () => ({ data: [], total: 0 }) as never },
      });

      await caller.getAll({ projectId: "project-1" });

      expect(policyCalls).toEqual([
        {
          permission: "datasets:view",
          path: "getAll",
          input: { projectId: "project-1" },
        },
      ]);
    });
  });

  describe("when the caller names an experiment instead of a dataset name", () => {
    it("borrows the experiment's name", async () => {
      const upsertDataset = vi.fn(async () => ({ id: "dataset-1" }) as never);
      const { caller, getById } = harness({ dataset: { upsertDataset } });

      await caller.upsert({
        projectId: "project-1",
        experimentId: "experiment-1",
        columnTypes: [],
      });

      expect(getById).toHaveBeenCalledWith({ projectId: "project-1", id: "experiment-1" });
      expect(upsertDataset).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Borrowed name" }),
      );
    });

    it("refuses when the experiment has no name to borrow", async () => {
      const upsertDataset = vi.fn();
      const { caller } = harness({ dataset: { upsertDataset }, experimentName: null });

      await expect(
        caller.upsert({
          projectId: "project-1",
          experimentId: "experiment-1",
          columnTypes: [],
        }),
      ).rejects.toThrow("Experiment experiment-1 has no name");
      expect(upsertDataset).not.toHaveBeenCalled();
    });
  });

  describe("when the dataset a read names is archived or missing", () => {
    it("reads as null rather than failing the page", async () => {
      const { caller } = harness({
        dataset: {
          getBySlugOrId: async () => {
            throw new DatasetNotFoundError("gone");
          },
        },
      });

      await expect(
        caller.getById({ projectId: "project-1", datasetId: "dataset-1" }),
      ).resolves.toBeNull();
    });
  });

  describe("when a write conflicts", () => {
    it("names a taken name apart from a stale editor", async () => {
      // The service throws the contract's undiscriminated conflict, which
      // means the name clash; the discriminated one carries the second
      // failure. The translation reads `name`, so both classes reach it.
      const nameTaken = harness({
        dataset: {
          validateDatasetName: async () => {
            throw new DatasetConflictError("taken");
          },
        },
      });
      const staleColumns = harness({
        dataset: {
          validateDatasetName: async () => {
            throw new DatasetConflictError("stale", { reason: "stale_columns" });
          },
        },
      });

      // The middleware throws the `HandledError` subclass directly (ADR-045);
      // this bare `initTRPC` harness carries no error formatter, so the raw
      // caller wraps it as INTERNAL_SERVER_ERROR with the original on `.cause`
      // — the host's real error formatter is what unwraps that back onto the
      // wire (see apps/api/src/app-trpc/__tests__/app-trpc-error-formatter).
      await expect(
        nameTaken.caller.validateDatasetName({ projectId: "project-1", proposedName: "x" }),
      ).rejects.toMatchObject({
        cause: { code: "dataset_name_taken", httpStatus: 409, fault: "customer" },
      });
      await expect(
        staleColumns.caller.validateDatasetName({ projectId: "project-1", proposedName: "x" }),
      ).rejects.toMatchObject({
        cause: { code: "dataset_stale_columns", httpStatus: 409, fault: "customer" },
      });
    });

    it("surfaces a missing dataset as NOT_FOUND through the error handler", async () => {
      const { caller } = harness({
        dataset: {
          findNextAvailableName: async () => {
            throw new DatasetNotFoundError("gone");
          },
        },
      });

      await expect(
        caller.findNextName({ projectId: "project-1", proposedName: "x" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("leaves an infrastructure failure as the host already framed it", async () => {
      const { caller } = harness({
        dataset: {
          findNextAvailableName: async () => {
            throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "connection lost" });
          },
        },
      });

      await expect(
        caller.findNextName({ projectId: "project-1", proposedName: "x" }),
      ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR", message: "connection lost" });
    });
  });

  describe("when a copy names a source project the caller may not read", () => {
    /** @scenario "A copy is refused when the source project is not the caller's" */
    it("refuses before the source dataset is read", async () => {
      const copyDataset = vi.fn();
      const { caller, probeProjectPermission } = harness({
        dataset: { copyDataset },
        sourcePermitted: false,
      });

      await expect(
        caller.copy({
          datasetId: "dataset-1",
          sourceProjectId: "victim-project",
          projectId: "project-1",
        }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      expect(probeProjectPermission).toHaveBeenCalledWith(
        expect.anything(),
        "victim-project",
        "datasets:create",
      );
      expect(copyDataset).not.toHaveBeenCalled();
    });

    it("copies into the target project once the source is permitted", async () => {
      const copyDataset = vi.fn(async () => ({ id: "copy-1" }) as never);
      const { caller } = harness({ dataset: { copyDataset } });

      await caller.copy({
        datasetId: "dataset-1",
        sourceProjectId: "source-project",
        projectId: "project-1",
      });

      expect(copyDataset).toHaveBeenCalledWith({
        sourceDatasetId: "dataset-1",
        sourceProjectId: "source-project",
        targetProjectId: "project-1",
      });
    });
  });
});
