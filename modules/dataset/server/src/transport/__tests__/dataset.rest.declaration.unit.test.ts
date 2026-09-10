/**
 * `/api/dataset`, pinned: every method, path, operation id and permission the
 * family publishes, and the handler behaviour each door owns. The operation
 * ids are the ones the published document already carries, so a rename here
 * renames an integrator's generated client.
 */

import { BadRequestError, NotFoundError, type PlatformUrlBuilder } from "@langwatch/api/rest";
import type { AuthzDeclaredScopeId } from "@langwatch/authz-contract";
import type { DatasetApi } from "@langwatch/dataset-contract";
import { describe, expect, it, vi } from "vitest";

import { completeDatasetApi } from "../../app/__tests__/dataset-api.fake.ts";
import { createDatasetRest } from "../dataset.rest.ts";

const platformUrl: PlatformUrlBuilder = ({ projectSlug, path }) =>
  `https://app.example.com/${projectSlug}${path}`;

const declaration = createDatasetRest(platformUrl).router();

const scope: AuthzDeclaredScopeId = { tier: "project", id: "project-1" };
const project = { projectSlug: "my-project", viewerUserId: null, actorId: "user-1" };

function answer(operation: string, app: DatasetApi, input: unknown): Promise<unknown> {
  const route = declaration.routes.find((candidate) => candidate.operation === operation);
  if (!route) throw new Error(`no route declares the operation "${operation}"`);

  return Promise.resolve(
    route.handler({ app, input, scope, actor: null, signal: undefined } as never, project),
  );
}

describe("the dataset REST declaration", () => {
  describe("given the family the process mounts", () => {
    it("keeps every published address, operation id and permission", () => {
      expect(
        declaration.routes.map((route) => ({
          method: route.method,
          path: route.path,
          operation: route.operation,
          permission: route.permission,
        })),
      ).toEqual([
        { method: "get", path: "/", operation: "getApiDataset", permission: "datasets:view" },
        { method: "post", path: "/", operation: "postApiDataset", permission: "datasets:create" },
        {
          method: "post",
          path: "/:slugOrId/records",
          operation: "postApiDatasetBySlugOrIdRecords",
          permission: "datasets:update",
        },
        {
          method: "post",
          path: "/:slug/entries",
          operation: "postApiDatasetBySlugEntries",
          permission: "datasets:update",
        },
        {
          method: "get",
          path: "/:slugOrId",
          operation: "getApiDatasetBySlugOrId",
          permission: "datasets:view",
        },
        {
          method: "patch",
          path: "/:slugOrId",
          operation: "patchApiDatasetBySlugOrId",
          permission: "datasets:manage",
        },
        {
          method: "delete",
          path: "/:slugOrId",
          operation: "deleteApiDatasetBySlugOrId",
          permission: "datasets:manage",
        },
        {
          method: "get",
          path: "/:slugOrId/records",
          operation: "getApiDatasetBySlugOrIdRecords",
          permission: "datasets:view",
        },
        {
          method: "delete",
          path: "/:slugOrId/records",
          operation: "deleteApiDatasetBySlugOrIdRecords",
          permission: "datasets:manage",
        },
      ]);
    });

    it("serves `/api/dataset` at the management vintage, dated addresses included", () => {
      expect(declaration.namespace).toBe("dataset");
      expect(declaration.version).toBe("2026-08-07");
      expect(declaration.addressing).toBe("dated");
      expect(declaration.credential).toBe("project");
    });

    it("answers a create with 201 and everything else with 200", () => {
      const created = declaration.routes
        .filter((route) => route.status === 201)
        .map((route) => route.operation);

      expect(created).toEqual(["postApiDataset", "postApiDatasetBySlugOrIdRecords"]);
    });
  });

  describe("when the project's datasets are listed", () => {
    it("passes the page window through and links each row into the platform", async () => {
      const listDatasets = vi.fn(async () => ({
        data: [{ id: "dataset-1" }],
        pagination: { page: 2, limit: 10, total: 1, totalPages: 1 },
      }));

      const body = (await answer(
        "getApiDataset",
        completeDatasetApi({ listDatasets: listDatasets as never }),
        { page: 2, limit: 10 },
      )) as { data: { platformUrl: string }[] };

      expect(listDatasets).toHaveBeenCalledWith({ projectId: "project-1", page: 2, limit: 10 });
      expect(body.data[0]?.platformUrl).toBe(
        "https://app.example.com/my-project/datasets/dataset-1",
      );
    });
  });

  describe("when one dataset is read whole", () => {
    it("asks for it under the family's own read ceiling", async () => {
      const getDatasetWithRecords = vi.fn(async () => ({
        dataset: { id: "dataset-1", name: "One", slug: "one", columnTypes: [] },
        records: [],
        truncated: false,
      }));

      await answer(
        "getApiDatasetBySlugOrId",
        completeDatasetApi({ getDatasetWithRecords: getDatasetWithRecords as never }),
        { slugOrId: "one" },
      );

      expect(getDatasetWithRecords).toHaveBeenCalledWith({
        slugOrId: "one",
        projectId: "project-1",
        limitMb: 25,
      });
    });

    it("refuses rather than truncating when the read exceeds that ceiling", async () => {
      const app = completeDatasetApi({
        getDatasetWithRecords: (async () => ({
          dataset: { id: "dataset-1", name: "One", slug: "one", columnTypes: [] },
          records: [],
          truncated: true,
        })) as never,
      });

      await expect(answer("getApiDatasetBySlugOrId", app, { slugOrId: "one" })).rejects.toThrow(
        BadRequestError,
      );
    });
  });

  describe("when a batch delete matches no entry", () => {
    it("answers 404 rather than reporting nothing was deleted", async () => {
      const app = completeDatasetApi({ deleteRecords: (async () => ({ count: 0 })) as never });

      await expect(
        answer("deleteApiDatasetBySlugOrIdRecords", app, {
          slugOrId: "one",
          recordIds: ["record-1"],
        }),
      ).rejects.toThrow(NotFoundError);
    });
  });
});
