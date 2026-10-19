/**
 * @vitest-environment node
 * The tier-effective queue bounds: the paged read clamps to the plan's page
 * size, the all-items read takes at most the plan's queue take.
 */
import { describe, expect, it } from "vitest";

import {
  createAnnotationTestApp,
  createAnnotationTestEntitlement,
  createAnnotationTestOrganizations,
  createAnnotationTestTraces,
} from "./annotation.fixture.ts";

const PROJECT_ID = "project-1";
const REVIEWER_ID = "reviewer-1";

async function appWithItems(tier: "free" | "paid" | "enterprise", itemCount: number) {
  const app = createAnnotationTestApp({
    dependencies: {
      organizations: createAnnotationTestOrganizations([REVIEWER_ID]),
      traces: Object.assign(createAnnotationTestTraces(), {
        findExistingTraceIds: async ({ traceIds }: { traceIds: readonly string[] }) => [
          ...traceIds,
        ],
      }),
      entitlement: createAnnotationTestEntitlement(tier),
    },
  });

  const traces = Array.from({ length: itemCount }, (_, index) => `trace-${index}`);

  await app.queueTraces({
    projectId: PROJECT_ID,
    traceIds: traces,
    annotators: [`user-${REVIEWER_ID}`],
    userId: REVIEWER_ID,
  });

  return app;
}

const list = (
  app: Awaited<ReturnType<typeof appWithItems>>,
  input: { pageSize: number; allQueueItems?: boolean },
) =>
  app.listOptimizedQueues({
    projectId: PROJECT_ID,
    userId: REVIEWER_ID,
    selectedAnnotations: "pending",
    pageSize: input.pageSize,
    pageOffset: 0,
    ...(input.allQueueItems === true ? { allQueueItems: true } : {}),
  });

describe("annotation queue bounds", () => {
  describe("when the caller pages", () => {
    it("clamps a free-tier caller's page size to 100", async () => {
      const app = await appWithItems("free", 150);

      const page = await list(app, { pageSize: 150 });

      expect(page.assignedQueueItems).toHaveLength(100);
      expect(page.totalCount).toBe(150);
    });

    it("clamps an enterprise caller's page size to 400", async () => {
      const app = await appWithItems("enterprise", 450);

      const page = await list(app, { pageSize: 450 });

      expect(page.assignedQueueItems).toHaveLength(400);
      expect(page.totalCount).toBe(450);
    });

    it("clamps a paid caller's page size to 200, and leaves an under-bound size alone", async () => {
      const app = await appWithItems("paid", 250);

      const clamped = await list(app, { pageSize: 250 });
      const underBound = await list(app, { pageSize: 150 });

      expect(clamped.assignedQueueItems).toHaveLength(200);
      expect(underBound.assignedQueueItems).toHaveLength(150);
    });
  });

  describe("when the caller asks for every queue item", () => {
    it("takes at most the free tier's 1000 even when more items exist", async () => {
      const app = await appWithItems("free", 1200);

      const page = await list(app, { pageSize: 25, allQueueItems: true });

      expect(page.assignedQueueItems).toHaveLength(1000);
      expect(page.totalCount).toBe(1200);
    });

    it("takes every item when the count sits under the paid tier's take", async () => {
      const app = await appWithItems("paid", 1200);

      const page = await list(app, { pageSize: 25, allQueueItems: true });

      expect(page.assignedQueueItems).toHaveLength(1200);
    });
  });
});
