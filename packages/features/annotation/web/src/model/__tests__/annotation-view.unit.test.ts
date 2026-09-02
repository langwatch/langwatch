/**
 * Which of the four lists a page key means, and what that decides.
 *
 * The view is a PROP rather than something read back out of the address, so
 * these are the assertions that used to be four page files handing four sets of
 * props to one table.
 *
 * Spec: packages/features/annotation/specs/annotations-list-selection.feature.
 */

import { describe, expect, it } from "vitest";
import { annotationViewCopy, viewReadsMemberQueues, type AnnotationView } from "../annotation-view";

const VIEWS: AnnotationView[] = ["inbox", "mine", "all", "queue"];

describe("given one of the four annotation views", () => {
  describe("when the list asks what it is", () => {
    it("dates a queued row by when it was queued and an annotated row by when it was annotated", () => {
      expect(annotationViewCopy("inbox").dateColumnLabel).toBe("Date queued");
      expect(annotationViewCopy("mine").dateColumnLabel).toBe("Date queued");
      expect(annotationViewCopy("queue").dateColumnLabel).toBe("Date queued");
      expect(annotationViewCopy("all").dateColumnLabel).toBe("Date annotated");
    });

    it("offers the status filter only where a row is queued work", () => {
      expect(annotationViewCopy("inbox").showStatusFilter).toBe(true);
      expect(annotationViewCopy("mine").showStatusFilter).toBe(true);
      expect(annotationViewCopy("queue").showStatusFilter).toBe(true);
      // All Annotations lists annotations, which are not waiting on anybody.
      expect(annotationViewCopy("all").showStatusFilter).toBe(false);
    });

    it("sends a waiting row to the queue walker, and an annotated row to its trace", () => {
      expect(annotationViewCopy("inbox").rowTarget).toBe("queueItem");
      expect(annotationViewCopy("mine").rowTarget).toBe("queueItem");
      expect(annotationViewCopy("queue").rowTarget).toBe("queueItem");
      expect(annotationViewCopy("all").rowTarget).toBe("trace");
    });

    it("gives the queue view no heading, because the queue's own name is one", () => {
      expect(annotationViewCopy("queue").heading).toBeUndefined();
      expect(annotationViewCopy("inbox").heading).toBe("Inbox");
      expect(annotationViewCopy("all").heading).toBe("All Annotations");
    });

    it("has something to say to every view when it holds nothing", () => {
      for (const view of VIEWS) {
        expect(annotationViewCopy(view).noDataTitle.length).toBeGreaterThan(0);
        expect(annotationViewCopy(view).noDataDescription.length).toBeGreaterThan(0);
      }
    });
  });

  /**
   * THE QUEUE-MEMBERSHIP PREDICATE. `showQueueAndUser` widens the read from the
   * reviewer's own items to every queue they are a member of, and exactly one
   * view wants that. Widening the reviewer's own queue would put a teammate's
   * work on a page titled "My Queue"; narrowing the Inbox would empty it for
   * anybody whose work arrives through a shared queue.
   */
  describe("when the list asks whose work to read", () => {
    it("reads every queue the reviewer is on for the Inbox and nowhere else", () => {
      expect(viewReadsMemberQueues("inbox")).toBe(true);
      expect(viewReadsMemberQueues("mine")).toBe(false);
      expect(viewReadsMemberQueues("queue")).toBe(false);
      expect(viewReadsMemberQueues("all")).toBe(false);
    });
  });
});
