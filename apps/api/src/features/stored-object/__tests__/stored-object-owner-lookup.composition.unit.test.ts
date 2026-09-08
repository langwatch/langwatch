/**
 * Who owns a stored object named by its id alone, as the API process composes the lookup
 * (specs/features/stored-object-legacy-id-only-owner.feature).
 */
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { describe, expect, it, vi } from "vitest";

import type { ApiStoredObjectsConfigResolution } from "../../../platform/config/api.config.ts";
import { installApiStoredObject } from "../stored-object.composition.ts";

const STORED_OBJECT_ID = "stored-object-1";

/** Local filesystem storage: the bytes are irrelevant to an owner lookup. */
function storage(): ApiStoredObjectsConfigResolution {
  return {
    driver: "file",
    file: { root: "/tmp/langwatch-owner-lookup" },
    s3: {},
    azure: {},
  } as unknown as ApiStoredObjectsConfigResolution;
}

/** One endpoint that answers the owner query, and the SQL it was handed. */
function endpoint(target: string, rows: Array<{ project_id: string }>) {
  const asked: string[] = [];
  return {
    asked,
    instance: {
      target,
      client: {
        query: async (input: { query: string }) => {
          asked.push(input.query);
          return { json: async () => rows };
        },
      },
    },
  };
}

function compose(instances: (() => readonly { target: string; client: unknown }[]) | null) {
  return installApiStoredObject({
    prisma: { project: { findUnique: vi.fn(async () => null) } } as unknown as PrismaClient,
    resolveClickHouseClient: null,
    clickHouseInstances: instances,
    storage: storage(),
  });
}

describe("given the API process composes the object store", () => {
  describe("when this deployment opened ClickHouse endpoints", () => {
    /** @scenario "A legacy id-only stored-object URL resolves its owning project" */
    it("finds the owner on whichever endpoint holds the row", async () => {
      const shared = endpoint("shared", []);
      const byoc = endpoint("org_byoc", [{ project_id: "project-7" }]);
      const feature = await compose(() => [shared.instance, byoc.instance]);

      try {
        const owner = await feature.app.resolveOwner({ id: STORED_OBJECT_ID });

        expect(owner).toEqual({ projectId: "project-7" });
        expect(shared.asked).toHaveLength(1);
        expect(byoc.asked[0]).toContain("FROM stored_objects");
      } finally {
        await feature.close();
      }
    });
  });

  describe("when this deployment opened no ClickHouse endpoint", () => {
    /** @scenario "An id-only URL on a deployment with no owner directory resolves to nothing" */
    it("resolves to nothing rather than claiming a project", async () => {
      const feature = await compose(null);

      try {
        await expect(feature.app.resolveOwner({ id: STORED_OBJECT_ID })).resolves.toBeNull();
      } finally {
        await feature.close();
      }
    });
  });
});
