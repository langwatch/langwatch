import { PLATFORM_DEFAULT_RETENTION_DAYS } from "@langwatch/data-retention-contract";
import { describe, expect, it } from "vitest";

import {
  createDataRetentionTestApp,
  createDataRetentionTestEntitlement,
  retentionTestGraph,
} from "./data-retention.fixture.ts";

const reader = { userId: "user-1" };

describe("the retention settings page reads", () => {
  describe("when the project sits in an organization on an enterprise plan", () => {
    it("answers the snapshot from the directory and offers configuration", async () => {
      const app = createDataRetentionTestApp();

      const snapshot = await app.getPolicySnapshot({
        projectId: retentionTestGraph.projectId,
        ...reader,
      });

      expect(snapshot).toMatchObject({
        projectId: retentionTestGraph.projectId,
        effective: {
          traces: PLATFORM_DEFAULT_RETENTION_DAYS,
          scenarios: PLATFORM_DEFAULT_RETENTION_DAYS,
          experiments: PLATFORM_DEFAULT_RETENTION_DAYS,
        },
        rules: [],
        canConfigureRetention: true,
      });
    });

    it("meters the project scope the selector names", async () => {
      const app = createDataRetentionTestApp();

      await expect(
        app.getScopeStorageUsage({
          projectId: retentionTestGraph.projectId,
          scope: { scopeType: "PROJECT", scopeId: retentionTestGraph.projectId },
          ...reader,
        }),
      ).resolves.toEqual({ totalBytes: 0, projectCount: 1 });
    });
  });

  describe("when entitlement answers a free plan", () => {
    it("reads the snapshot but offers no configuration", async () => {
      const app = createDataRetentionTestApp({
        dependencies: {
          entitlement: createDataRetentionTestEntitlement({ free: true, type: "FREE" }),
        },
      });

      const snapshot = await app.getPolicySnapshot({
        projectId: retentionTestGraph.projectId,
        ...reader,
      });

      expect(snapshot.canConfigureRetention).toBe(false);
    });
  });
});
