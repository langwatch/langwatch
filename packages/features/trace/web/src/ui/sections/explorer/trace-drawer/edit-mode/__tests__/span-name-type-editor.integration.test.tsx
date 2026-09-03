/**
 * @vitest-environment jsdom
 *
 * The name and type editors seed from the correction the trace already carries,
 * so a second reviewer reads what the first one wrote instead of reverting it
 * the moment they touch the field.
 * See specs/traces-v2/trace-edit-mode.feature.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { TraceEditOverlayPatch } from "@langwatch/trace-contract";
import {
  buildTraceEditPatch,
  selectIsTraceEditDirty,
  useTraceEditStore,
} from "../../../../../../index";
import { SpanNameTypeEditor } from "../span-name-type-editor";

const CAPTURED_NAME = "handler";
const CORRECTED_NAME = "search the web";

const storedCorrection: TraceEditOverlayPatch = {
  version: 1,
  spans: [{ spanId: "span-1", name: CORRECTED_NAME }],
  deletedSpanIds: [],
};

function draftState() {
  return useTraceEditStore.getState();
}

function renderEditor() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <SpanNameTypeEditor
        spanId="span-1"
        capturedName={CAPTURED_NAME}
        capturedType="llm"
      />
    </ChakraProvider>,
  );
}

const nameField = () => screen.getByLabelText("Span name") as HTMLInputElement;

beforeEach(() => {
  useTraceEditStore.getState().discard();
});

afterEach(cleanup);

describe("given a trace that was already corrected once", () => {
  beforeEach(() => {
    useTraceEditStore
      .getState()
      .startEditing({ traceId: "trace-1", basePatch: storedCorrection });
  });

  describe("when the reviewer opens that span", () => {
    /** @scenario "A second correction starts from what the first one said" */
    it("shows the corrected name rather than the captured one", () => {
      renderEditor();

      expect(nameField().value).toBe(CORRECTED_NAME);
    });
  });

  describe("when the reviewer corrects another field on that span", () => {
    /** @scenario "A second correction starts from what the first one said" */
    it("keeps the earlier rename in the correction", () => {
      renderEditor();

      fireEvent.change(screen.getByLabelText("Span type"), {
        target: { value: "tool" },
      });

      expect(buildTraceEditPatch(draftState()).spans).toEqual([
        { spanId: "span-1", name: CORRECTED_NAME, type: "tool" },
      ]);
    });
  });

  describe("when the reviewer types in the name field and puts it back", () => {
    /** @scenario "Touching a field and putting it back leaves nothing to save" */
    it("leaves nothing to save", () => {
      renderEditor();

      fireEvent.change(nameField(), { target: { value: "look it up" } });
      expect(selectIsTraceEditDirty(draftState())).toBe(true);

      fireEvent.change(nameField(), { target: { value: CORRECTED_NAME } });

      expect(selectIsTraceEditDirty(draftState())).toBe(false);
      expect(nameField().value).toBe(CORRECTED_NAME);
    });
  });
});

describe("given a trace with no correction", () => {
  beforeEach(() => {
    useTraceEditStore.getState().startEditing({ traceId: "trace-1" });
  });

  describe("when the reviewer opens a span", () => {
    /** @scenario "Save is unavailable until the reviewer changes something" */
    it("shows the captured name", () => {
      renderEditor();

      expect(nameField().value).toBe(CAPTURED_NAME);
    });
  });
});
