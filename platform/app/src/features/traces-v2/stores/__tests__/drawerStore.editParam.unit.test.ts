import { beforeEach, describe, expect, it } from "vitest";
import { parseEditParam, useDrawerStore } from "../drawerStore";
import { selectIsTraceEditDirty, useTraceEditStore } from "../traceEditStore";

describe("drawer.edit URL parameter", () => {
  beforeEach(() => {
    useTraceEditStore.getState().discard();
    useDrawerStore.getState().setEditing(false);
  });

  describe("given a link that asks for edit mode", () => {
    describe("when the drawer reads it", () => {
      /** @scenario "A deep link into edit mode starts the drawer editing" */
      it("opens the trace in edit mode", () => {
        expect(parseEditParam({ raw: "1", traceId: "trace-1" })).toBe(true);
      });
    });

    describe("when it points at a sample preview trace", () => {
      /** @scenario "Edit mode is dropped from a link to a preview trace" */
      it("opens the trace without edit mode", () => {
        expect(parseEditParam({ raw: "1", traceId: "lw-preview-chat" })).toBe(
          false,
        );
      });
    });
  });

  describe("given a link that does not ask for edit mode", () => {
    describe("when the drawer reads it", () => {
      /** @scenario "A deep link into edit mode starts the drawer editing" */
      it("opens the trace for reading", () => {
        expect(parseEditParam({ raw: undefined, traceId: "trace-1" })).toBe(
          false,
        );
        expect(parseEditParam({ raw: "0", traceId: "trace-1" })).toBe(false);
        expect(parseEditParam({ raw: "1", traceId: null })).toBe(false);
      });
    });
  });

  describe("given an editing session with unsaved changes", () => {
    describe("when browser history moves to a URL without the parameter", () => {
      /** @scenario "Cancelling with unsaved changes asks first" */
      it("keeps the session open rather than discarding the work", () => {
        useDrawerStore.getState().setEditing(true);
        useTraceEditStore.getState().startEditing({ traceId: "trace-1" });
        useTraceEditStore
          .getState()
          .setSpanName({ spanId: "span-1", name: "search the web" });

        useDrawerStore.getState().hydrateUrlState({ editing: false });

        expect(useDrawerStore.getState().editing).toBe(true);
        expect(selectIsTraceEditDirty(useTraceEditStore.getState())).toBe(true);
      });
    });
  });

  describe("given an editing session with nothing changed", () => {
    describe("when browser history moves to a URL without the parameter", () => {
      /** @scenario "Cancelling without changes leaves edit mode straight away" */
      it("leaves edit mode", () => {
        useDrawerStore.getState().setEditing(true);
        useTraceEditStore.getState().startEditing({ traceId: "trace-1" });

        useDrawerStore.getState().hydrateUrlState({ editing: false });

        expect(useDrawerStore.getState().editing).toBe(false);
      });
    });
  });
});
