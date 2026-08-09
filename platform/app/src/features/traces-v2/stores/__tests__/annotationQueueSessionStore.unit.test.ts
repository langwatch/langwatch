/**
 * The traces one sitting at the annotation queue has collected: what counts
 * them in, what takes them back out, and why the reviewer's own choice outlives
 * the rule of thumb. See specs/annotations/annotation-queue-workflow.feature.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  isSessionMarked,
  sessionTraceIds,
  useAnnotationQueueSessionStore,
} from "../annotationQueueSessionStore";

const state = () => useAnnotationQueueSessionStore.getState();

beforeEach(() => {
  useAnnotationQueueSessionStore.setState({
    active: false,
    marks: {},
    handoff: "idle",
  });
});

describe("given a sitting at the queue", () => {
  describe("when a turn is annotated", () => {
    /** @scenario "Annotating a turn counts its trace into the session" */
    it("counts its trace into the sitting", () => {
      state().setActive(true);
      state().noteAnnotationSaved("trace-1");

      expect(isSessionMarked(state().marks, "trace-1")).toBe(true);
      expect(sessionTraceIds(state().marks)).toEqual(["trace-1"]);
    });
  });

  describe("when the reviewer ticks a turn they only read", () => {
    /** @scenario "A turn is counted in or out by hand" */
    it("counts it in", () => {
      state().toggle("trace-2");

      expect(isSessionMarked(state().marks, "trace-2")).toBe(true);
      expect(sessionTraceIds(state().marks)).toEqual(["trace-2"]);
    });
  });

  describe("when the reviewer unticks a turn they annotated", () => {
    /** @scenario "A turn is counted in or out by hand" */
    it("takes it back out and keeps it out when annotated again", () => {
      state().noteAnnotationSaved("trace-3");
      state().toggle("trace-3");

      expect(isSessionMarked(state().marks, "trace-3")).toBe(false);

      state().noteAnnotationSaved("trace-3");

      expect(isSessionMarked(state().marks, "trace-3")).toBe(false);
      expect(sessionTraceIds(state().marks)).toEqual([]);
    });
  });

  describe("when the reviewer ticks a turn back in after unticking it", () => {
    it("counts it again", () => {
      state().noteAnnotationSaved("trace-4");
      state().toggle("trace-4");
      state().toggle("trace-4");

      expect(isSessionMarked(state().marks, "trace-4")).toBe(true);
    });
  });
});

describe("given a sitting that counted two turns", () => {
  describe("when the queue is left", () => {
    /** @scenario "Session marks belong to the sitting" */
    it("counts nothing any more", () => {
      state().setActive(true);
      state().noteAnnotationSaved("trace-5");
      state().toggle("trace-6");
      state().noteHandoffOpened();

      state().setActive(false);

      expect(state().marks).toEqual({});
      expect(sessionTraceIds(state().marks)).toEqual([]);
      expect(state().handoff).toBe("idle");
    });
  });
});

describe("given the hand-off to a dataset at the end of the queue", () => {
  it("reads where it has got to", () => {
    expect(state().handoff).toBe("idle");

    state().noteHandoffOpened();
    expect(state().handoff).toBe("open");

    state().noteHandoffAdded();
    expect(state().handoff).toBe("added");

    state().resetHandoff();
    expect(state().handoff).toBe("idle");
  });
});
