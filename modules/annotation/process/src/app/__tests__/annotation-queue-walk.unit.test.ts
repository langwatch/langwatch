/**
 * @vitest-environment node
 * One step of the reviewer's pending queue, read through the memory twin.
 */
import { describe, expect, it } from "vitest";

import {
  createAnnotationTestApp,
  createAnnotationTestOrganizations,
  createAnnotationTestTraces,
} from "./annotation.fixture.ts";

const PROJECT_ID = "project-1";
const REVIEWER_ID = "reviewer-1";

async function appWithQueue(traceIds: readonly string[]) {
  const resolvable = new Set(traceIds);
  const app = createAnnotationTestApp({
    dependencies: {
      organizations: createAnnotationTestOrganizations([REVIEWER_ID]),
      traces: Object.assign(createAnnotationTestTraces(), {
        findExistingTraceIds: async ({ traceIds: ids }: { traceIds: readonly string[] }) =>
          ids.filter((id) => resolvable.has(id)),
      }),
    },
  });

  await app.queueTraces({
    projectId: PROJECT_ID,
    traceIds: [...traceIds],
    annotators: [`user-${REVIEWER_ID}`],
    userId: REVIEWER_ID,
  });

  return { app, resolvable };
}

const step = (app: Awaited<ReturnType<typeof appWithQueue>>["app"], queueItemId?: string) =>
  app.getQueueWalkStep({
    projectId: PROJECT_ID,
    userId: REVIEWER_ID,
    ...(queueItemId === undefined ? {} : { queueItemId }),
  });

describe("annotation queue walk step", () => {
  describe("when the reviewer has nothing pending", () => {
    it("answers an empty, finished step", async () => {
      const { app } = await appWithQueue([]);

      await expect(step(app)).resolves.toEqual({
        item: null,
        position: 0,
        total: 0,
        previousItemId: null,
        nextItemId: null,
        queueFinished: true,
      });
    });
  });

  describe("when the reviewer walks a queue of three", () => {
    it("starts at the front and names the neighbours either side", async () => {
      const { app } = await appWithQueue(["trace-a", "trace-b", "trace-c"]);

      const first = await step(app);
      expect(first).toMatchObject({ position: 1, total: 3, previousItemId: null });
      expect(first.nextItemId).not.toBeNull();

      const second = await step(app, first.nextItemId ?? undefined);
      expect(second).toMatchObject({
        position: 2,
        total: 3,
        previousItemId: first.item?.id,
      });

      const third = await step(app, second.nextItemId ?? undefined);
      expect(third).toMatchObject({
        position: 3,
        previousItemId: second.item?.id,
        nextItemId: null,
      });
    });

    it("lands a link to a finished item on the next thing waiting", async () => {
      const { app } = await appWithQueue(["trace-a", "trace-b"]);
      const first = await step(app);
      const finishedId = first.item?.id ?? "";

      await app.markQueueItemDone({
        projectId: PROJECT_ID,
        userId: REVIEWER_ID,
        queueItemId: finishedId,
      });

      const landed = await step(app, finishedId);
      expect(landed.item?.id).not.toBe(finishedId);
      expect(landed).toMatchObject({ position: 1, total: 1 });
    });
  });

  describe("when the item's trace no longer reads back", () => {
    it("keeps the queue walkable while another queued trace still exists", async () => {
      const { app } = await appWithQueue(["trace-a", "trace-b"]);

      await expect(step(app)).resolves.toMatchObject({ queueFinished: false });
    });

    it("calls the queue finished when no queued trace exists any more", async () => {
      const { app, resolvable } = await appWithQueue(["trace-a", "trace-b"]);
      resolvable.clear();

      await expect(step(app)).resolves.toMatchObject({ total: 2, queueFinished: true });
    });
  });
});
