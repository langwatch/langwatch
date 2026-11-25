/**
 * Whole-trace reads and the review queue over anchored comments, through the
 * composed annotation app on its memory twins.
 * See specs/traces-v2/anchored-comments.feature.
 */
import { describe, expect, it } from "vitest";

import {
  createAnnotationTestApp,
  createAnnotationTestOrganizations,
  createAnnotationTestTraces,
} from "./annotation.fixture.ts";

const PROJECT_ID = "project-1";
const TRACE_ID = "trace-1";
const REVIEWER_ID = "reviewer-1";

const base = {
  projectId: PROJECT_ID,
  traceId: TRACE_ID,
  isThumbsUp: null,
  scoreOptions: {},
  expectedOutput: null,
};

function appWithReviewer() {
  const traces = createAnnotationTestTraces();
  traces.findExistingTraceIds = async ({ traceIds }) => [...traceIds];

  return createAnnotationTestApp({
    dependencies: { organizations: createAnnotationTestOrganizations([REVIEWER_ID]), traces },
  });
}

async function commentOnSpans(app: ReturnType<typeof appWithReviewer>) {
  for (const span of ["span-1", "span-2", "span-3"]) {
    await app.create({
      ...base,
      id: `on-${span}`,
      comment: `about ${span}`,
      anchorKind: "span",
      anchorId: span,
    });
  }
}

describe("anchored comments on whole-trace reads", () => {
  describe("given a trace with one comment about the trace and three about its spans", () => {
    /** @scenario "The project's annotations list holds every comment with its target named" */
    it("lists all four, each anchored one naming the span it is about", async () => {
      const app = appWithReviewer();
      await app.create({ ...base, id: "on-trace", comment: "the whole trace" });
      await commentOnSpans(app);

      const listed = await app.list({ projectId: PROJECT_ID, traceIds: [TRACE_ID], anchor: "all" });

      expect(listed.map((annotation) => annotation.id).toSorted()).toEqual([
        "on-span-1",
        "on-span-2",
        "on-span-3",
        "on-trace",
      ]);
      expect(listed.find((annotation) => annotation.id === "on-trace")).toMatchObject({
        anchorKind: null,
        anchorId: null,
      });

      for (const span of ["span-1", "span-2", "span-3"]) {
        expect(listed.find((annotation) => annotation.id === `on-${span}`)).toMatchObject({
          anchorKind: "span",
          anchorId: span,
        });
      }
    });
  });

  describe("given a trace carrying comments on three of its spans", () => {
    /** @scenario "A comment on one part of a trace never becomes a queue item" */
    it("leaves every queue read empty until the trace is itself queued", async () => {
      const app = appWithReviewer();
      await commentOnSpans(app);

      await expect(
        app.listReviewQueueItems({ projectId: PROJECT_ID, userId: REVIEWER_ID }),
      ).resolves.toEqual([]);
      await expect(
        app.countAssignedItems({ projectId: PROJECT_ID, userId: REVIEWER_ID }),
      ).resolves.toBe(0);
      await expect(
        app.listOptimizedQueues({
          projectId: PROJECT_ID,
          userId: REVIEWER_ID,
          selectedAnnotations: "pending",
          queueId: "",
          pageSize: 20,
          pageOffset: 0,
        }),
      ).resolves.toMatchObject({ assignedQueueItems: [] });
    });

    /** @scenario "Sending a commented trace to a queue sends the trace once" */
    it("queues the trace as one item, however many comments it carries", async () => {
      const app = appWithReviewer();
      await commentOnSpans(app);

      await expect(
        app.queueTraces({
          projectId: PROJECT_ID,
          traceIds: [TRACE_ID],
          annotators: [`user-${REVIEWER_ID}`],
          userId: REVIEWER_ID,
        }),
      ).resolves.toEqual({ created: 1, skipped: 0 });

      const items = await app.listReviewQueueItems({ projectId: PROJECT_ID, userId: REVIEWER_ID });

      expect(items.map((item) => item.traceId)).toEqual([TRACE_ID]);
      await expect(
        app.countAssignedItems({ projectId: PROJECT_ID, userId: REVIEWER_ID }),
      ).resolves.toBe(1);
    });
  });
});
