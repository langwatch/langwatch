/**
 * The process policy wrapped around the package-owned dataset, dataset record
 * and batch record transports. The proof this file carries is that the move
 * changed nothing a caller can observe: the same procedure names, the same
 * declared access decision on each one, and — the load-bearing one — that the
 * declared check still reads its scope id from the VALIDATED input.
 *
 * That last assertion is the whole hazard of this shape. tRPC appends the
 * input parser where `.input()` is called, so a policy composed ahead of it
 * hands the authorization check, the scope-lineage guard and the audit row
 * `input === undefined` — and all three then pass while reporting green.
 *
 * @vitest-environment node
 */
import { type AuthzDeclaration, authzDeclarationOf } from "@langwatch/authz-contract";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppAuditLogRuntime } from "~/runtime/app/features/audit-log";
import type { RequestAppServices } from "~/runtime/app/requestApp";
import { createInnerTRPCContext } from "~/server/api/trpc";
import type { TRPCContext } from "~/server/api/trpc.context";
import { batchRecordRouter } from "../batch-record.router";
import { datasetRouter } from "../dataset.router";
import { datasetRecordRouter } from "../dataset-record.router";

const PROJECT_ID = "project_dataset_mount";

function declarationsOf(router: unknown): Record<string, AuthzDeclaration | null> {
  const procedures = (router as { _def: { procedures: Record<string, unknown> } })._def.procedures;

  return Object.fromEntries(
    Object.entries(procedures).map(([path, procedure]) => {
      const middlewares = (procedure as { _def?: { middlewares?: unknown[] } })._def?.middlewares;
      const declaration =
        (middlewares ?? [])
          .map((middleware) => authzDeclarationOf(middleware))
          .find((found) => found !== null) ?? null;
      return [path, declaration];
    }),
  );
}

function procedureNames(router: unknown): string[] {
  return Object.keys((router as { _def: { procedures: Record<string, unknown> } })._def.procedures);
}

function buildContext({
  permitted,
  session = { user: { id: "user_dataset_mount" }, expires: "1" },
}: {
  permitted: boolean;
  session?: { user: { id: string }; expires: string } | null;
}) {
  const decisions: unknown[] = [];
  const lineageInputs: unknown[] = [];
  const listDatasets = vi.fn(async () => ({ data: [], pagination: { page: 1, limit: 200 } }));
  const permissions = {
    checkScopeLineage: async (input: unknown) => {
      lineageInputs.push(input);
      return { kind: "consistent" as const };
    },
    getDecision: async (decision: unknown) => {
      decisions.push(decision);
      return {
        permitted,
        organizationRole: null,
        denialReason: permitted ? undefined : ("no-binding" as const),
      };
    },
  };
  // Only the services the mounted chain actually reaches. The composed test
  // App is deliberately not used: it would drag every unrelated runtime into a
  // test about who may call these seventeen procedures.
  const app = { permissions, dataset: { listDatasets } } as unknown as RequestAppServices;

  return {
    decisions,
    lineageInputs,
    listDatasets,
    context: createInnerTRPCContext({
      app,
      session,
      permissionChecked: false,
      publiclyShared: false,
    }),
  };
}

const auditRows: unknown[] = [];

describe("dataset transport mount", () => {
  // A refused call is audited, and the audit sink is a process singleton the
  // composition root installs. Collect the rows rather than reach a database.
  beforeAll(() => {
    AppAuditLogRuntime.install({
      prisma: { auditLog: { create: async (row: unknown) => auditRows.push(row) } },
    } as never);
  });
  afterAll(() => {
    AppAuditLogRuntime.clear();
  });

  describe("given the composed routers", () => {
    /** @scenario "The dataset transports move without changing who may call them" */
    it("keeps the legacy dataset procedure names the browser calls", () => {
      expect(procedureNames(datasetRouter).sort()).toEqual([
        "copy",
        "deleteById",
        "findNextName",
        "getAll",
        "getById",
        "updateMapping",
        "upsert",
        "validateDatasetName",
      ]);
    });

    /** @scenario "The dataset transports move without changing who may call them" */
    it("keeps the legacy dataset record procedure names the browser calls", () => {
      expect(procedureNames(datasetRecordRouter).sort()).toEqual([
        "create",
        "deleteMany",
        "download",
        "getAll",
        "getHead",
        "listPaginated",
        "update",
      ]);
    });

    /** @scenario "The dataset transports move without changing who may call them" */
    it("keeps the legacy batch record procedure names the browser calls", () => {
      expect(procedureNames(batchRecordRouter).sort()).toEqual([
        "getAllByexperimentIdGroup",
        "getAllByexperimentSlug",
      ]);
    });

    /** @scenario "The dataset transports move without changing who may call them" */
    it("declares the same access decision on every dataset procedure", () => {
      expect(declarationsOf(datasetRouter)).toEqual({
        upsert: { kind: "permission", permission: "datasets:manage", via: undefined },
        validateDatasetName: { kind: "permission", permission: "datasets:view", via: undefined },
        getAll: { kind: "permission", permission: "datasets:view", via: undefined },
        getById: { kind: "permission", permission: "datasets:view", via: undefined },
        deleteById: { kind: "permission", permission: "datasets:delete", via: undefined },
        updateMapping: { kind: "permission", permission: "datasets:update", via: undefined },
        findNextName: { kind: "permission", permission: "datasets:view", via: undefined },
        copy: { kind: "permission", permission: "datasets:create", via: undefined },
      });
    });

    /** @scenario "The dataset transports move without changing who may call them" */
    it("declares the same access decision on every dataset record procedure", () => {
      expect(declarationsOf(datasetRecordRouter)).toEqual({
        create: { kind: "permission", permission: "datasets:create", via: undefined },
        update: { kind: "permission", permission: "datasets:update", via: undefined },
        getAll: { kind: "permission", permission: "datasets:view", via: undefined },
        listPaginated: { kind: "permission", permission: "datasets:view", via: undefined },
        download: { kind: "permission", permission: "datasets:view", via: undefined },
        getHead: { kind: "permission", permission: "datasets:view", via: undefined },
        deleteMany: { kind: "permission", permission: "datasets:delete", via: undefined },
      });
    });

    /** @scenario "The dataset transports move without changing who may call them" */
    it("declares the same access decision on every batch record procedure", () => {
      expect(declarationsOf(batchRecordRouter)).toEqual({
        getAllByexperimentIdGroup: {
          kind: "permission",
          permission: "workflows:view",
          via: undefined,
        },
        getAllByexperimentSlug: {
          kind: "permission",
          permission: "workflows:view",
          via: undefined,
        },
      });
    });
  });

  describe("when a permitted caller reads the project's datasets", () => {
    /** @scenario "The declared check reads the validated input" */
    it("checks the project the validated input named, and only then reads", async () => {
      const { context, decisions, lineageInputs, listDatasets } = buildContext({
        permitted: true,
      });

      const listed = await datasetRouter.createCaller(context).getAll({ projectId: PROJECT_ID });

      // Both the lineage guard and the declared check are installed by the
      // process AFTER the feature's own `.input()`, so both see the parsed
      // input rather than `undefined`.
      expect(lineageInputs).toEqual([{ projectId: PROJECT_ID }]);
      expect(decisions).toEqual([
        {
          userId: "user_dataset_mount",
          permission: "datasets:view",
          scope: { tier: "project", id: PROJECT_ID },
        },
      ]);
      // Reaching a result at all means `enforcePermissionCheck` saw the
      // declared check mark the request, so no procedure here can answer
      // without one having run.
      expect(listed).toEqual([]);
      expect(listDatasets).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        page: 1,
        limit: 200,
      });
    });
  });

  describe("when the decision refuses", () => {
    it("refuses before the dataset service runs", async () => {
      const { context, listDatasets } = buildContext({ permitted: false });

      await expect(
        datasetRouter.createCaller(context).getAll({ projectId: PROJECT_ID }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(listDatasets).not.toHaveBeenCalled();
    });
  });

  describe("when the caller has no session", () => {
    it("refuses the dataset surface before the service runs", async () => {
      const { context } = buildContext({ permitted: true, session: null });

      await expect(
        datasetRouter.createCaller(context).getAll({ projectId: PROJECT_ID }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });

    it("refuses the dataset record surface before the service runs", async () => {
      const { context } = buildContext({ permitted: true, session: null });

      await expect(
        datasetRecordRouter
          .createCaller(context)
          .getAll({ projectId: PROJECT_ID, datasetId: "dataset-1" }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });

    it("refuses the batch record surface before the table is read", async () => {
      const { context } = buildContext({ permitted: true, session: null });
      const groupBy = vi.fn();
      const unreadable = {
        ...context,
        prisma: { batchEvaluation: { groupBy } },
      } as unknown as TRPCContext;

      await expect(
        batchRecordRouter
          .createCaller(unreadable)
          .getAllByexperimentIdGroup({ projectId: PROJECT_ID }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      expect(groupBy).not.toHaveBeenCalled();
    });
  });
});
