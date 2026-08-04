import { beforeEach, describe, expect, it } from "vitest";
import type { TraceEditOverlayPatch } from "~/server/traces/edit-overlay/traceEditOverlay.schemas";
import {
  buildTraceEditPatch,
  selectIsSpanDeleted,
  selectIsTraceEditDirty,
  summarizeTraceEdit,
  useTraceEditStore,
} from "../traceEditStore";

function state() {
  return useTraceEditStore.getState();
}

function draftState() {
  const s = state();
  return {
    basePatch: s.basePatch,
    spanDrafts: s.spanDrafts,
    deletedSpanIds: s.deletedSpanIds,
    restoredSpanIds: s.restoredSpanIds,
    traceOutputDraft: s.traceOutputDraft,
  };
}

const storedCorrection: TraceEditOverlayPatch = {
  version: 1,
  spans: [{ spanId: "span-1", name: "renamed earlier" }],
  deletedSpanIds: ["span-9"],
};

describe("traceEditStore", () => {
  beforeEach(() => {
    state().discard();
  });

  describe("given a fresh editing session", () => {
    describe("when nothing has been touched", () => {
      /** @scenario "Save is unavailable until the reviewer changes something" */
      it("reports no changes", () => {
        state().startEditing({ traceId: "trace-1" });

        expect(selectIsTraceEditDirty(draftState())).toBe(false);
      });
    });

    describe("when a span is renamed", () => {
      /** @scenario "Save is unavailable until the reviewer changes something" */
      it("reports a change", () => {
        state().startEditing({ traceId: "trace-1" });
        state().setSpanName({ spanId: "span-1", name: "search the web" });

        expect(selectIsTraceEditDirty(draftState())).toBe(true);
      });
    });

    describe("when a span is renamed and another is deleted", () => {
      /** @scenario "The bar counts what the correction changes" */
      it("counts one changed field and one deleted span", () => {
        state().startEditing({ traceId: "trace-1" });
        state().setSpanName({ spanId: "span-1", name: "search the web" });
        state().deleteSpan("span-2");

        expect(summarizeTraceEdit(draftState())).toEqual({
          changedFields: 1,
          deletedSpans: 1,
        });
      });
    });
  });

  describe("given a draft left over from an earlier trace", () => {
    describe("when editing starts on another trace", () => {
      /** @scenario "A deep link into edit mode starts the drawer editing" */
      it("starts from a clean slate", () => {
        state().startEditing({ traceId: "trace-1" });
        state().setSpanName({ spanId: "span-1", name: "left behind" });

        state().startEditing({ traceId: "trace-2" });

        expect(state().editingTraceId).toBe("trace-2");
        expect(state().spanDrafts).toEqual({});
        expect(selectIsTraceEditDirty(draftState())).toBe(false);
      });
    });
  });

  describe("given a span deleted in this session", () => {
    describe("when it is restored", () => {
      /** @scenario "Restoring a deleted span brings it back" */
      it("stops being deleted and stops counting as a change", () => {
        state().startEditing({ traceId: "trace-1" });
        state().deleteSpan("span-2");
        expect(selectIsSpanDeleted(state(), "span-2")).toBe(true);

        state().restoreSpan("span-2");

        expect(selectIsSpanDeleted(state(), "span-2")).toBe(false);
        expect(selectIsTraceEditDirty(draftState())).toBe(false);
      });
    });
  });

  describe("given unsaved changes", () => {
    describe("when the session is discarded", () => {
      /** @scenario "Discarding drops the changes and leaves edit mode" */
      it("drops every change and leaves edit mode", () => {
        state().startEditing({ traceId: "trace-1" });
        state().setSpanName({ spanId: "span-1", name: "search the web" });
        state().deleteSpan("span-2");

        state().discard();

        expect(state().editingTraceId).toBeNull();
        expect(state().spanDrafts).toEqual({});
        expect(state().deletedSpanIds).toEqual([]);
        expect(selectIsTraceEditDirty(draftState())).toBe(false);
      });
    });
  });

  describe("given a trace that was already corrected once", () => {
    describe("when a different span is corrected", () => {
      /** @scenario "Saving records the correction and leaves edit mode" */
      it("keeps the earlier correction and adds the new one", () => {
        state().startEditing({
          traceId: "trace-1",
          basePatch: storedCorrection,
        });
        state().setSpanName({ spanId: "span-2", name: "read the file" });

        const patch = buildTraceEditPatch(draftState());

        expect(patch.spans).toEqual([
          { spanId: "span-1", name: "renamed earlier" },
          { spanId: "span-2", name: "read the file" },
        ]);
        expect(patch.deletedSpanIds).toEqual(["span-9"]);
      });
    });

    describe("when a span the correction deleted is restored", () => {
      /** @scenario "Restoring a deleted span brings it back" */
      it("drops it from the deletions the correction stores", () => {
        state().startEditing({
          traceId: "trace-1",
          basePatch: storedCorrection,
        });

        state().restoreSpan("span-9");

        expect(selectIsSpanDeleted(state(), "span-9")).toBe(false);
        expect(buildTraceEditPatch(draftState()).deletedSpanIds).toEqual([]);
      });
    });
  });

  describe("given an edited span output", () => {
    describe("when the captured value was a JSON object", () => {
      /** @scenario "Text that is not valid JSON is accepted with a warning" */
      it("saves text that is not JSON as plain text", () => {
        state().startEditing({ traceId: "trace-1" });
        state().setSpanIO({
          spanId: "span-1",
          field: "output",
          text: "the weather in Berlin is mild",
          baselineText: '{"temperature":18}',
        });

        const patch = buildTraceEditPatch(draftState());

        expect(patch.spans[0]?.output).toEqual({
          type: "text",
          value: "the weather in Berlin is mild",
        });
      });

      /** @scenario "A captured JSON value opens as readable JSON" */
      it("saves JSON as a structured value", () => {
        state().startEditing({ traceId: "trace-1" });
        state().setSpanIO({
          spanId: "span-1",
          field: "output",
          text: '{"temperature": 21}',
          baselineText: '{"temperature":18}',
        });

        const patch = buildTraceEditPatch(draftState());

        expect(patch.spans[0]?.output).toEqual({
          type: "json",
          value: { temperature: 21 },
        });
      });
    });
  });

  describe("given edited attributes", () => {
    describe("when a key is changed and another removed", () => {
      /** @scenario "Changing an attribute value records it in the correction" */
      it("stores the whole attribute record as corrected", () => {
        state().startEditing({ traceId: "trace-1" });
        const baselineParams = { model: "gpt-5-mini", temperature: 0.2 };
        state().setSpanParam({
          spanId: "span-1",
          key: "model",
          value: "gpt-5",
          baselineParams,
        });
        state().setSpanParam({
          spanId: "span-1",
          key: "temperature",
          value: null,
          baselineParams,
        });

        const patch = buildTraceEditPatch(draftState());

        expect(patch.spans[0]?.params).toEqual({ model: "gpt-5" });
      });
    });

    describe("when a nested attribute is changed", () => {
      /** @scenario "Changing an attribute value records it in the correction" */
      it("replaces the value in place instead of adding a dotted key", () => {
        state().startEditing({ traceId: "trace-1" });
        state().setSpanParam({
          spanId: "span-1",
          key: "langwatch.params.region",
          value: "eu-central-1",
          baselineParams: {
            langwatch: { params: { region: "eu-west-1", retries: 0 } },
          },
        });

        const patch = buildTraceEditPatch(draftState());

        expect(patch.spans[0]?.params).toEqual({
          langwatch: { params: { region: "eu-central-1", retries: 0 } },
        });
      });
    });

    describe("when a nested attribute is removed", () => {
      /** @scenario "Changing an attribute value records it in the correction" */
      it("drops the leaf and any ancestor left empty", () => {
        state().startEditing({ traceId: "trace-1" });
        const baselineParams = {
          langwatch: { params: { retries: 0 }, span: { type: "tool" } },
        };
        state().setSpanParam({
          spanId: "span-1",
          key: "langwatch.params.retries",
          value: null,
          baselineParams,
        });

        const patch = buildTraceEditPatch(draftState());

        expect(patch.spans[0]?.params).toEqual({
          langwatch: { span: { type: "tool" } },
        });
      });
    });

    describe("when an attribute is added", () => {
      /** @scenario "Changing an attribute value records it in the correction" */
      it("keeps the new key as the reviewer typed it", () => {
        state().startEditing({ traceId: "trace-1" });
        state().setSpanParam({
          spanId: "span-1",
          key: "langwatch.params.verified_by",
          value: "support-qa",
          baselineParams: { langwatch: { params: { retries: 0 } } },
        });

        const patch = buildTraceEditPatch(draftState());

        expect(patch.spans[0]?.params).toEqual({
          langwatch: { params: { retries: 0 } },
          "langwatch.params.verified_by": "support-qa",
        });
      });
    });
  });

  describe("given a deleted span that was also edited", () => {
    describe("when the correction is built", () => {
      /** @scenario "Deleting a span marks it and its descendants" */
      it("carries the deletion and no field changes for it", () => {
        state().startEditing({ traceId: "trace-1" });
        state().setSpanName({ spanId: "span-1", name: "does not matter" });
        state().deleteSpan("span-1");

        const patch = buildTraceEditPatch(draftState());

        expect(patch.spans).toEqual([]);
        expect(patch.deletedSpanIds).toEqual(["span-1"]);
      });
    });
  });
});
