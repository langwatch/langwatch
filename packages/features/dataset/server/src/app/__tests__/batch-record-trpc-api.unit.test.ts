/**
 * @vitest-environment node
 *
 * The `batchRecord.*` tRPC surface itself: the two procedure names the
 * batch-evaluation pages call, the `workflows:view` both declare, and the
 * slug-to-id resolution that must happen before either read — an unknown slug
 * is a 404, not an unscoped read of the project's records.
 *
 * `sees the parsed input` is the load-bearing one: the host's authorization
 * check, scope-lineage guard and audit row are installed by the policy THIS
 * file injects, and a policy composed ahead of `.input()` receives
 * `input === undefined` while all three still report green.
 */
import { initTRPC } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";

import type { DatasetService } from "@langwatch/dataset-contract";

import { BatchRecordTrpcApi } from "../../transport/api-trpc/batch-record.api";
import { DatasetApp } from "../dataset.app";

type TestContext = { app: { dataset: DatasetApp } };

type PolicyCall = { permission: string; path: string; input: unknown };

function harness({ experiment = { id: "experiment-1" } as { id: string } | null } = {}) {
  const policyCalls: PolicyCall[] = [];
  const declaredPermissions: string[] = [];
  const summariseByExperiment = vi.fn(async () => [{ experimentId: "experiment-1" }]);
  const listByExperiment = vi.fn(async () => [{ id: "batch-1" }]);
  const tryGetBySlug = vi.fn(async () => experiment);

  const trpc = initTRPC.context<TestContext>().create();
  const policy = (permission: string) => {
    declaredPermissions.push(permission);
    return <TProcedure>(procedure: TProcedure): TProcedure =>
      (procedure as any).use(async (opts: any) => {
        policyCalls.push({ permission, path: opts.path, input: opts.input });
        return opts.next();
      }) as TProcedure;
  };

  const router = BatchRecordTrpcApi.create(
    trpc,
    { protected: trpc.procedure, policy: policy as never },
    { summariseByExperiment, listByExperiment },
  );

  return {
    router,
    policyCalls,
    declaredPermissions,
    summariseByExperiment,
    listByExperiment,
    tryGetBySlug,
    caller: router.createCaller({
      app: {
        dataset: DatasetApp.create({
          // This surface reads no dataset: the two record reads are host ports.
          dataset: {} as DatasetService,
          experiments: {
            tryGetBySlug,
            getById: async () => {
              throw new Error("the batch-record surface reads no experiment by id");
            },
          },
        }),
      },
    }),
  };
}

describe("BatchRecordTrpcApi", () => {
  describe("given the mounted router", () => {
    it("exposes exactly the procedure names the batch-evaluation pages call", () => {
      const { router } = harness();

      expect(Object.keys(router._def.procedures)).toEqual([
        "getAllByexperimentIdGroup",
        "getAllByexperimentSlug",
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
        getAllByexperimentIdGroup: "workflows:view",
        getAllByexperimentSlug: "workflows:view",
      });
    });
  });

  describe("when the index reads the project's batch evaluations", () => {
    /** @scenario "The declared check reads the validated input" */
    it("hands the host policy the parsed input and returns the host's rows", async () => {
      const { caller, policyCalls, summariseByExperiment } = harness();

      await expect(caller.getAllByexperimentIdGroup({ projectId: "project-1" })).resolves.toEqual([
        { experimentId: "experiment-1" },
      ]);
      expect(summariseByExperiment).toHaveBeenCalledWith(expect.anything(), {
        projectId: "project-1",
      });
      expect(policyCalls).toEqual([
        {
          permission: "workflows:view",
          path: "getAllByexperimentIdGroup",
          input: { projectId: "project-1" },
        },
      ]);
    });
  });

  describe("when a page names an experiment by slug", () => {
    it("reads the records of the experiment that slug resolves to", async () => {
      const { caller, listByExperiment, tryGetBySlug } = harness();

      await expect(
        caller.getAllByexperimentSlug({ projectId: "project-1", experimentSlug: "my-run" }),
      ).resolves.toEqual([{ id: "batch-1" }]);
      expect(tryGetBySlug).toHaveBeenCalledWith({ projectId: "project-1", slug: "my-run" });
      expect(listByExperiment).toHaveBeenCalledWith(expect.anything(), {
        projectId: "project-1",
        experimentId: "experiment-1",
      });
    });

    it("refuses an unknown slug with NOT_FOUND, reading no records", async () => {
      const { caller, listByExperiment } = harness({ experiment: null });

      await expect(
        caller.getAllByexperimentSlug({ projectId: "project-1", experimentSlug: "gone" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND", message: "Experiment not found" });
      expect(listByExperiment).not.toHaveBeenCalled();
    });
  });
});
