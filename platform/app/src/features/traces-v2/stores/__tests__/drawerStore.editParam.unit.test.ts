import { beforeEach, describe, expect, it } from "vitest";
import {
  parseEditParam,
  useDrawerStore,
  viewModeForEditState,
} from "../drawerStore";
import { selectIsTraceEditDirty, useTraceEditStore } from "../traceEditStore";

describe("drawer.edit URL parameter", () => {
  beforeEach(() => {
    useTraceEditStore.getState().discard();
    useDrawerStore.getState().setIsEditing(false);
  });

  describe("given a link that asks for annotation mode", () => {
    describe("when the drawer reads it", () => {
      /** @scenario "A deep link into annotation mode starts the drawer in it" */
      it("opens the trace in annotation mode", () => {
        expect(parseEditParam({ raw: "1", traceId: "trace-1" })).toBe(true);
      });
    });

    describe("when it points at a sample preview trace", () => {
      /** @scenario "Annotation mode is dropped from a link to a preview trace" */
      it("opens the trace without annotation mode", () => {
        expect(parseEditParam({ raw: "1", traceId: "lw-preview-chat" })).toBe(
          false,
        );
      });
    });
  });

  describe("given a link that does not ask for annotation mode", () => {
    describe("when the drawer reads it", () => {
      /** @scenario "A deep link into annotation mode starts the drawer in it" */
      it("opens the trace for reading", () => {
        expect(parseEditParam({ raw: undefined, traceId: "trace-1" })).toBe(
          false,
        );
        expect(parseEditParam({ raw: "0", traceId: "trace-1" })).toBe(false);
        expect(parseEditParam({ raw: "1", traceId: null })).toBe(false);
      });
    });
  });

  describe("given a link that asks for annotation mode and a view the pass cannot act on", () => {
    describe("when the drawer reads it", () => {
      /** @scenario "A link naming annotation mode and a view the pass cannot act on opens on the trace" */
      it("opens on the trace view", () => {
        for (const viewMode of ["terminal", "session"] as const) {
          expect(viewModeForEditState({ viewMode, isEditing: true })).toBe(
            "trace",
          );
        }
      });

      it("keeps the view the link names when it is not annotating", () => {
        expect(
          viewModeForEditState({
            viewMode: "session",
            isEditing: false,
          }),
        ).toBe("session");
      });

      it("keeps a view the pass can act on", () => {
        expect(
          viewModeForEditState({ viewMode: "summary", isEditing: true }),
        ).toBe("summary");
      });
    });
  });

  describe("given a link that asks to annotate the trace on its conversation", () => {
    describe("when the drawer reads it", () => {
      /** @scenario "A link asking to annotate on the conversation view opens on the conversation" */
      it("opens on the conversation view", () => {
        expect(
          viewModeForEditState({ viewMode: "conversation", isEditing: true }),
        ).toBe("conversation");
      });
    });
  });

  describe("given an editing session with unsaved changes", () => {
    describe("when browser history moves to a URL without the parameter", () => {
      /** @scenario "Cancelling with unsaved changes asks first" */
      it("keeps the session open rather than discarding the work", () => {
        useDrawerStore.getState().setIsEditing(true);
        useTraceEditStore.getState().startEditing({ traceId: "trace-1" });
        useTraceEditStore.getState().setSpanName({
          spanId: "span-1",
          name: "search the web",
          baselineName: "handler",
        });

        useDrawerStore.getState().hydrateUrlState({ isEditing: false });

        expect(useDrawerStore.getState().isEditing).toBe(true);
        expect(selectIsTraceEditDirty(useTraceEditStore.getState())).toBe(true);
      });
    });
  });

  describe("given an editing session with nothing changed", () => {
    describe("when browser history moves to a URL without the parameter", () => {
      /** @scenario "Cancelling without changes leaves edit mode straight away" */
      it("leaves edit mode", () => {
        useDrawerStore.getState().setIsEditing(true);
        useTraceEditStore.getState().startEditing({ traceId: "trace-1" });

        useDrawerStore.getState().hydrateUrlState({ isEditing: false });

        expect(useDrawerStore.getState().isEditing).toBe(false);
      });
    });
  });

  describe("given a reader who switched to the captured trace", () => {
    describe("when they open another trace", () => {
      /** @scenario "The captured trace is a choice about the trace in front of me" */
      it("opens it corrected", () => {
        useTraceEditStore.getState().setOverlayView("original");

        useDrawerStore.getState().openTrace("trace-2", null);

        expect(useTraceEditStore.getState().overlayView).toBe("edited");
      });
    });
  });
});
