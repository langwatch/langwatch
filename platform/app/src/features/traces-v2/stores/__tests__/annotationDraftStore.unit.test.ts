/**
 * The annotation composer's values live outside the component tree so a turn
 * scrolling out of view cannot take them with it, and so only one composer is
 * ever open. See specs/traces-v2/annotation-rail.feature.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { useAnnotationDraftStore } from "../annotationDraftStore";

const store = () => useAnnotationDraftStore.getState();

beforeEach(() => {
  useAnnotationDraftStore.setState({ draft: null });
});

describe("given no annotation is being written", () => {
  it("holds no draft", () => {
    expect(store().draft).toBeNull();
  });

  describe("when the reviewer starts an annotation on a turn", () => {
    it("opens an empty draft for that turn", () => {
      store().openDraft({ traceId: "trace-1", mode: "annotate" });

      expect(store().draft).toMatchObject({
        traceId: "trace-1",
        mode: "annotate",
        comment: "",
        expectedOutput: "",
        seededFromExisting: false,
      });
    });

    /** @scenario "A suggestion starts from the turn's current output" */
    it("starts a suggestion from the turn's current output", () => {
      store().openDraft({
        traceId: "trace-1",
        mode: "suggest",
        output: "the original answer",
      });

      expect(store().draft?.expectedOutput).toBe("the original answer");
    });

    it("leaves the expected output alone when the turn is only being rated", () => {
      store().openDraft({
        traceId: "trace-1",
        mode: "annotate",
        output: "the original answer",
      });

      expect(store().draft?.expectedOutput).toBe("");
    });

    it("marks an edit draft as not yet taken from the stored annotation", () => {
      store().openDraft({
        traceId: "trace-1",
        mode: "annotate",
        annotationId: "annotation-1",
      });

      expect(store().draft?.seededFromExisting).toBe(false);
    });
  });
});

describe("given the reviewer is writing an annotation on a turn", () => {
  beforeEach(() => {
    store().openDraft({ traceId: "trace-1", mode: "annotate" });
    store().patchDraft({ comment: "half a thought" });
  });

  it("keeps what was typed", () => {
    expect(store().draft?.comment).toBe("half a thought");
  });

  it("keeps the rest of the draft when one field is patched", () => {
    store().patchDraft({ scoreOptions: { "score-1": { value: "good" } } });

    expect(store().draft).toMatchObject({
      traceId: "trace-1",
      comment: "half a thought",
      scoreOptions: { "score-1": { value: "good" } },
    });
  });

  describe("when they start an annotation on another turn", () => {
    /** @scenario "Only one annotation is composed at a time" */
    it("replaces the first composer with the second", () => {
      store().openDraft({ traceId: "trace-2", mode: "annotate" });

      expect(store().draft).toMatchObject({
        traceId: "trace-2",
        comment: "",
      });
    });
  });

  describe("when they close the composer", () => {
    /** @scenario "Closing the composer discards what was typed" */
    it("discards the comment", () => {
      store().closeDraft();

      expect(store().draft).toBeNull();
    });
  });
});

describe("given no composer is open", () => {
  describe("when a patch arrives anyway", () => {
    it("stays closed rather than reviving a draft", () => {
      store().patchDraft({ comment: "typed into nothing" });

      expect(store().draft).toBeNull();
    });
  });
});
