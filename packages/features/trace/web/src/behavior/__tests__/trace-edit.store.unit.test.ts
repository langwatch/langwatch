import { beforeEach, describe, expect, it } from "vitest";
import type { TraceEditOverlayPatch } from "@langwatch/trace-contract";
import { useDrawerStore } from "../drawer.store";
import {
  buildTraceEditPatch,
  selectIsSpanDeleted,
  selectIsTraceEditDirty,
  summarizeTraceEdit,
  useTraceEditStore,
} from "../trace-edit.store";

function state() {
  return useTraceEditStore.getState();
}

function draftState() {
  return state();
}

/** The name the trace recorded, which every rename below is measured against. */
const CAPTURED_NAME = "handler";

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
        state().setSpanName({
          spanId: "span-1",
          name: "search the web",
          baselineName: CAPTURED_NAME,
        });

        expect(selectIsTraceEditDirty(draftState())).toBe(true);
      });
    });

    describe("when a span is renamed and another is deleted", () => {
      /** @scenario "The bar counts what the correction changes" */
      it("counts one changed field and one deleted span", () => {
        state().startEditing({ traceId: "trace-1" });
        state().setSpanName({
          spanId: "span-1",
          name: "search the web",
          baselineName: CAPTURED_NAME,
        });
        state().deleteSpan("span-2");

        expect(summarizeTraceEdit(draftState())).toEqual({
          changedFields: 1,
          deletedSpans: 1,
        });
      });
    });
  });

  describe("given an unsaved correction on the open trace", () => {
    describe("when the drawer opens a different trace", () => {
      /** @scenario "Opening a different trace drops the draft from the last one" */
      it("drops the draft rather than carrying it over", () => {
        state().startEditing({ traceId: "trace-1" });
        state().setSpanName({
          spanId: "span-1",
          name: "left behind",
          baselineName: CAPTURED_NAME,
        });

        useDrawerStore.getState().openTrace("trace-2", 1000);

        expect(state().editingTraceId).toBeNull();
        expect(state().spanDrafts).toEqual({});
        expect(selectIsTraceEditDirty(draftState())).toBe(false);
      });
    });

    describe("when the drawer opens the same trace again", () => {
      /** @scenario "Re-entering edit mode on the same trace keeps the draft" */
      it("keeps the draft so edit mode can be re-entered on it", () => {
        state().startEditing({ traceId: "trace-1" });
        state().setSpanName({
          spanId: "span-1",
          name: "search the web",
          baselineName: CAPTURED_NAME,
        });

        useDrawerStore.getState().openTrace("trace-1", 1000);

        expect(state().editingTraceId).toBe("trace-1");
        expect(state().spanDrafts).toEqual({
          "span-1": { name: "search the web" },
        });
      });
    });
  });

  describe("given a draft left over from an earlier trace", () => {
    describe("when editing starts on another trace", () => {
      /** @scenario "A deep link into annotation mode starts the drawer in it" */
      it("starts from a clean slate", () => {
        state().startEditing({ traceId: "trace-1" });
        state().setSpanName({
          spanId: "span-1",
          name: "left behind",
          baselineName: CAPTURED_NAME,
        });

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
        state().setSpanName({
          spanId: "span-1",
          name: "search the web",
          baselineName: CAPTURED_NAME,
        });
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
        state().setSpanName({
          spanId: "span-2",
          name: "read the file",
          baselineName: CAPTURED_NAME,
        });

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
        state().setSpanName({
          spanId: "span-1",
          name: "does not matter",
          baselineName: CAPTURED_NAME,
        });
        state().deleteSpan("span-1");

        const patch = buildTraceEditPatch(draftState());

        expect(patch.spans).toEqual([]);
        expect(patch.deletedSpanIds).toEqual(["span-1"]);
      });
    });
  });

  describe("given a field the reviewer changed and changed back", () => {
    describe("when the name is typed back to what was captured", () => {
      /** @scenario "Touching a field and putting it back leaves nothing to save" */
      it("leaves no draft behind", () => {
        state().startEditing({ traceId: "trace-1" });
        state().setSpanName({
          spanId: "span-1",
          name: "search the web",
          baselineName: CAPTURED_NAME,
        });

        state().setSpanName({
          spanId: "span-1",
          name: CAPTURED_NAME,
          baselineName: CAPTURED_NAME,
        });

        expect(state().spanDrafts).toEqual({});
        expect(selectIsTraceEditDirty(draftState())).toBe(false);
      });
    });

    describe("when the name is typed back to what an earlier correction said", () => {
      /** @scenario "Touching a field and putting it back leaves nothing to save" */
      it("leaves no draft behind", () => {
        state().startEditing({
          traceId: "trace-1",
          basePatch: storedCorrection,
        });

        state().setSpanName({
          spanId: "span-1",
          name: "renamed earlier",
          baselineName: "renamed earlier",
        });

        expect(state().spanDrafts).toEqual({});
        expect(selectIsTraceEditDirty(draftState())).toBe(false);
      });
    });

    describe("when the type is put back", () => {
      /** @scenario "Touching a field and putting it back leaves nothing to save" */
      it("leaves no draft behind", () => {
        state().startEditing({ traceId: "trace-1" });
        state().setSpanType({
          spanId: "span-1",
          type: "tool",
          baselineType: "llm",
        });

        state().setSpanType({
          spanId: "span-1",
          type: "llm",
          baselineType: "llm",
        });

        expect(selectIsTraceEditDirty(draftState())).toBe(false);
      });
    });

    describe("when the output editor is left holding the captured value", () => {
      /** @scenario "Touching a field and putting it back leaves nothing to save" */
      it("treats the value the editor formatted as unchanged", () => {
        state().startEditing({ traceId: "trace-1" });
        state().setSpanIO({
          spanId: "span-1",
          field: "output",
          text: '{"temperature": 21}',
          baselineText: '{"temperature":18}',
        });

        // What `seedEditorText` puts in the editor for this captured value.
        state().setSpanIO({
          spanId: "span-1",
          field: "output",
          text: '{\n  "temperature": 18\n}',
          baselineText: '{"temperature":18}',
        });

        expect(state().spanDrafts).toEqual({});
        expect(selectIsTraceEditDirty(draftState())).toBe(false);
      });
    });

    describe("when the trace output is typed back to what was captured", () => {
      /** @scenario "Touching a field and putting it back leaves nothing to save" */
      it("leaves no draft behind", () => {
        state().startEditing({ traceId: "trace-1" });
        state().setTraceOutput({
          text: "a different answer",
          baselineText: "the captured answer",
        });

        state().setTraceOutput({
          text: "the captured answer",
          baselineText: "the captured answer",
        });

        expect(state().traceOutputDraft).toBeNull();
        expect(selectIsTraceEditDirty(draftState())).toBe(false);
      });
    });

    describe("when an attribute is set back to its captured value", () => {
      /** @scenario "Touching a field and putting it back leaves nothing to save" */
      it("leaves no draft behind", () => {
        state().startEditing({ traceId: "trace-1" });
        const baselineParams = { langwatch: { params: { retries: 0 } } };
        state().setSpanParam({
          spanId: "span-1",
          key: "langwatch.params.retries",
          value: 3,
          baselineParams,
        });

        state().setSpanParam({
          spanId: "span-1",
          key: "langwatch.params.retries",
          value: 0,
          baselineParams,
        });

        expect(state().spanDrafts).toEqual({});
        expect(selectIsTraceEditDirty(draftState())).toBe(false);
      });
    });
  });

  describe("given an attribute edited before the stored correction was read", () => {
    describe("when the correction lands", () => {
      /** @scenario "An attribute changed before the stored correction arrives keeps it" */
      it("keeps the attributes the correction already changed", () => {
        const correction: TraceEditOverlayPatch = {
          version: 1,
          spans: [
            {
              spanId: "span-1",
              params: { model: "gpt-5", temperature: 0.2 },
            },
          ],
          deletedSpanIds: [],
        };
        state().startEditing({ traceId: "trace-1" });
        // The captured attributes, because the correction has not arrived yet.
        state().setSpanParam({
          spanId: "span-1",
          key: "temperature",
          value: 0.7,
          baselineParams: { model: "gpt-5-mini", temperature: 0.2 },
        });

        state().adoptBasePatch({ traceId: "trace-1", basePatch: correction });

        expect(buildTraceEditPatch(draftState()).spans[0]?.params).toEqual({
          model: "gpt-5",
          temperature: 0.7,
        });
      });
    });
  });

  describe("given the trace's own input", () => {
    describe("when it is rewritten", () => {
      /** @scenario "Correcting the trace input counts as a change" */
      it("counts as one change and travels in the correction", () => {
        state().startEditing({ traceId: "trace-1" });
        state().setTraceInput({
          text: "what is the weather in Berlin?",
          baselineText: "wat is het weer",
        });

        expect(summarizeTraceEdit(draftState())).toEqual({
          changedFields: 1,
          deletedSpans: 0,
        });
        expect(buildTraceEditPatch(draftState()).trace).toEqual({
          input: { value: "what is the weather in Berlin?" },
        });
      });
    });

    describe("when the captured text is typed back", () => {
      /** @scenario "Typing the trace input back leaves nothing to save" */
      it("leaves no draft behind", () => {
        state().startEditing({ traceId: "trace-1" });
        state().setTraceInput({
          text: "a different question",
          baselineText: "the captured question",
        });

        state().setTraceInput({
          text: "the captured question",
          baselineText: "the captured question",
        });

        expect(state().traceInputDraft).toBeNull();
        expect(selectIsTraceEditDirty(draftState())).toBe(false);
      });
    });

    describe("when a correction already changed it", () => {
      /** @scenario "Correcting the trace input counts as a change" */
      it("keeps the stored input when this session leaves it alone", () => {
        state().startEditing({
          traceId: "trace-1",
          basePatch: {
            version: 1,
            trace: { input: { value: "corrected earlier" } },
            spans: [],
            deletedSpanIds: [],
          },
        });
        state().setTraceOutput({
          text: "a better answer",
          baselineText: "the captured answer",
        });

        expect(buildTraceEditPatch(draftState()).trace).toEqual({
          input: { value: "corrected earlier" },
          output: { value: "a better answer" },
        });
      });
    });
  });

  describe("given the trace's own metadata", () => {
    const CAPTURED_METADATA = {
      environment: "staging",
      reviewer: "unassigned",
    };

    describe("when one key is changed and another removed", () => {
      /** @scenario "Corrected metadata is saved as one map of the keys that changed" */
      it("names both keys and nothing else", () => {
        state().startEditing({ traceId: "trace-1" });
        state().setTraceMetadata({
          key: "environment",
          value: "production",
          baselineMetadata: CAPTURED_METADATA,
        });
        state().setTraceMetadata({
          key: "reviewer",
          value: null,
          baselineMetadata: CAPTURED_METADATA,
        });

        expect(buildTraceEditPatch(draftState()).trace).toEqual({
          metadata: { environment: "production", reviewer: null },
        });
      });

      /** @scenario "Corrected metadata is saved as one map of the keys that changed" */
      it("counts the metadata as one changed field", () => {
        state().startEditing({ traceId: "trace-1" });
        state().setTraceMetadata({
          key: "environment",
          value: "production",
          baselineMetadata: CAPTURED_METADATA,
        });
        state().setTraceMetadata({
          key: "reviewer",
          value: null,
          baselineMetadata: CAPTURED_METADATA,
        });

        expect(summarizeTraceEdit(draftState())).toEqual({
          changedFields: 1,
          deletedSpans: 0,
        });
      });
    });

    describe("when a key the trace does not carry is added", () => {
      /** @scenario "Corrected metadata is saved as one map of the keys that changed" */
      it("carries the new key", () => {
        state().startEditing({ traceId: "trace-1" });
        state().setTraceMetadata({
          key: "reviewed_by",
          value: "support",
          baselineMetadata: CAPTURED_METADATA,
        });

        expect(buildTraceEditPatch(draftState()).trace).toEqual({
          metadata: { reviewed_by: "support" },
        });
      });
    });

    describe("when a value is put back to what was captured", () => {
      /** @scenario "A metadata value put back leaves nothing to save" */
      it("leaves no draft behind", () => {
        state().startEditing({ traceId: "trace-1" });
        state().setTraceMetadata({
          key: "environment",
          value: "production",
          baselineMetadata: CAPTURED_METADATA,
        });

        state().setTraceMetadata({
          key: "environment",
          value: "staging",
          baselineMetadata: CAPTURED_METADATA,
        });

        expect(state().traceMetadataDrafts).toEqual({});
        expect(selectIsTraceEditDirty(draftState())).toBe(false);
      });

      /** @scenario "A metadata value put back leaves nothing to save" */
      it("leaves no draft behind when a removed key is restored", () => {
        state().startEditing({ traceId: "trace-1" });
        state().setTraceMetadata({
          key: "reviewer",
          value: null,
          baselineMetadata: CAPTURED_METADATA,
        });

        state().resetTraceMetadata("reviewer");

        expect(state().traceMetadataDrafts).toEqual({});
        expect(selectIsTraceEditDirty(draftState())).toBe(false);
      });
    });

    describe("when a correction already changed some of it", () => {
      /** @scenario "Corrected metadata is saved as one map of the keys that changed" */
      it("layers this session's keys on the stored ones", () => {
        state().startEditing({
          traceId: "trace-1",
          basePatch: {
            version: 1,
            trace: { metadata: { environment: "production" } },
            spans: [],
            deletedSpanIds: [],
          },
        });
        state().setTraceMetadata({
          key: "reviewed_by",
          value: "support",
          baselineMetadata: { environment: "production" },
        });

        expect(buildTraceEditPatch(draftState()).trace).toEqual({
          metadata: { environment: "production", reviewed_by: "support" },
        });
      });
    });
  });

  describe("given a correction that only changes the trace output", () => {
    describe("when the reviewer touched a span attribute and put it back", () => {
      /**
       * The report this came from: only the trace output was rewritten, and the
       * saved correction carried a span entry holding the whole attribute tree,
       * which then read as edited on every row.
       *
       * @scenario "Correcting only the trace output stores no span correction"
       */
      it("stores no span entry at all", () => {
        const capturedInput = JSON.stringify([
          { role: "user", content: "what is the weather in Berlin?" },
        ]);
        const baselineParams = {
          gen_ai: { request: { model: "gpt-5-mini" } },
          langwatch: {
            input: capturedInput,
            output: '{"type":"text","value":"mild"}',
            reserved: { value_types: '{"input":"chat_messages"}' },
          },
        };
        state().startEditing({ traceId: "trace-1" });
        state().setTraceOutput({
          text: "it is mild in Berlin",
          baselineText: "mild",
        });
        // What the editor used to hand back for a value the trace recorded as
        // one string: the same content, read as a structure.
        state().setSpanParam({
          spanId: "span-1",
          key: "langwatch.input",
          value: JSON.parse(capturedInput),
          baselineParams,
        });

        const patch = buildTraceEditPatch(draftState());

        expect(patch.spans).toEqual([]);
        expect(patch.trace).toEqual({
          output: { value: "it is mild in Berlin" },
        });
      });
    });

    describe("when a draft ends up saying exactly what the span already said", () => {
      /** @scenario "Correcting only the trace output stores no span correction" */
      it("stores no span entry at all", () => {
        const patch = buildTraceEditPatch({
          basePatch: null,
          spanDrafts: {
            "span-1": {
              paramsBase: { model: "gpt-5-mini" },
              params: { model: "gpt-5-mini" },
            },
          },
          deletedSpanIds: [],
          restoredSpanIds: [],
          traceInputDraft: null,
          traceOutputDraft: {
            text: "it is mild in Berlin",
            baselineText: "mild",
          },
          traceMetadataDrafts: {},
        });

        expect(patch.spans).toEqual([]);
      });
    });
  });

  describe("given an attribute the reviewer touched", () => {
    describe("when the captured value is typed back", () => {
      /** @scenario "An attribute typed over and typed back stores no attribute correction" */
      it("stores no span entry at all", () => {
        const baselineParams = { model: "gpt-5-mini", temperature: 0.2 };
        state().startEditing({ traceId: "trace-1" });
        state().setSpanParam({
          spanId: "span-1",
          key: "model",
          value: "gpt-5",
          baselineParams,
        });

        state().setSpanParam({
          spanId: "span-1",
          key: "model",
          value: "gpt-5-mini",
          baselineParams,
        });

        expect(buildTraceEditPatch(draftState()).spans).toEqual([]);
      });
    });

    describe("when the trace recorded a JSON document as text", () => {
      /** @scenario "Retyping the captured text into an attribute recorded as text is not a change" */
      it("treats the same document read as a structure as unchanged", () => {
        const recorded = '{"tools":["search"],"retries":0}';
        const baselineParams = { "langwatch.params": recorded };
        state().startEditing({ traceId: "trace-1" });

        state().setSpanParam({
          spanId: "span-1",
          key: "langwatch.params",
          value: JSON.parse(recorded),
          baselineParams,
        });

        expect(state().spanDrafts).toEqual({});
        expect(selectIsTraceEditDirty(draftState())).toBe(false);
      });

      /** @scenario "Retyping the captured text into an attribute recorded as text is not a change" */
      it("still records a document that says something different", () => {
        const recorded = '{"tools":["search"],"retries":0}';
        const baselineParams = { "langwatch.params": recorded };
        state().startEditing({ traceId: "trace-1" });

        state().setSpanParam({
          spanId: "span-1",
          key: "langwatch.params",
          value: { tools: ["search"], retries: 3 },
          baselineParams,
        });

        expect(selectIsTraceEditDirty(draftState())).toBe(true);
      });
    });
  });

  describe("given a correction stored while this one was being written", () => {
    describe("when the session is rebased onto it", () => {
      /** @scenario "Saving builds on the correction as it stands" */
      it("keeps what it changed and carries this session's change too", () => {
        state().startEditing({ traceId: "trace-1", basePatch: null });
        state().setSpanName({
          spanId: "span-2",
          name: "read the file",
          baselineName: CAPTURED_NAME,
        });

        state().rebaseBasePatch({
          traceId: "trace-1",
          basePatch: storedCorrection,
        });

        const patch = buildTraceEditPatch(draftState());

        expect(patch.spans).toEqual([
          { spanId: "span-1", name: "renamed earlier" },
          { spanId: "span-2", name: "read the file" },
        ]);
        expect(patch.deletedSpanIds).toEqual(["span-9"]);
      });

      /** @scenario "Saving builds on the correction as it stands" */
      it("replaces a baseline the session had already adopted", () => {
        const newer: TraceEditOverlayPatch = {
          version: 1,
          spans: [{ spanId: "span-3", name: "renamed by someone else" }],
          deletedSpanIds: [],
        };
        state().startEditing({
          traceId: "trace-1",
          basePatch: storedCorrection,
        });

        state().rebaseBasePatch({ traceId: "trace-1", basePatch: newer });

        expect(buildTraceEditPatch(draftState()).spans).toEqual([
          { spanId: "span-3", name: "renamed by someone else" },
        ]);
      });
    });
  });
});
