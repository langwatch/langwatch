import { describe, expect, it } from "vitest";

import {
  isOccurredAtParam,
  parseEditParam,
  readTraceDrawerAddress,
  viewModeForEditState,
} from "../trace-drawer-params.ts";

describe("drawer.edit URL parameter", () => {
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
        expect(parseEditParam({ raw: "1", traceId: "lw-preview-chat" })).toBe(false);
      });
    });
  });

  describe("given a link that does not ask for annotation mode", () => {
    describe("when the drawer reads it", () => {
      /** @scenario "A deep link into annotation mode starts the drawer in it" */
      it("opens the trace for reading", () => {
        expect(parseEditParam({ raw: undefined, traceId: "trace-1" })).toBe(false);
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
          expect(viewModeForEditState({ viewMode, isEditing: true })).toBe("trace");
        }
      });

      it("keeps the view the link names when it is not annotating", () => {
        expect(viewModeForEditState({ viewMode: "session", isEditing: false })).toBe("session");
      });

      it("keeps a view the pass can act on", () => {
        expect(viewModeForEditState({ viewMode: "summary", isEditing: true })).toBe("summary");
      });
    });
  });

  describe("given a link that asks to annotate the trace on its conversation", () => {
    describe("when the drawer reads it", () => {
      /** @scenario "A link asking to annotate on the conversation view opens on the conversation" */
      it("opens on the conversation view", () => {
        expect(viewModeForEditState({ viewMode: "conversation", isEditing: true })).toBe(
          "conversation",
        );
      });
    });
  });
});

describe("isOccurredAtParam", () => {
  describe("given the trace's start time from a short link", () => {
    it("accepts it as the partition hint", () => {
      expect(isOccurredAtParam("1714476000000")).toBe(true);
    });
  });

  describe("given a value that is not a positive whole number", () => {
    it.each(["yesterday", "0", "-5", "1.5", "", "017", null, undefined])("drops %s", (raw) => {
      expect(isOccurredAtParam(raw)).toBe(false);
    });
  });
});

describe("readTraceDrawerAddress", () => {
  describe("given the trace drawer is named without a trace", () => {
    it("reads as closed", () => {
      expect(readTraceDrawerAddress({ "drawer.open": "traceV2Details" }).isOpen).toBe(false);
    });
  });

  describe("given a pinned-spans value with repeats and blanks", () => {
    it("keeps each span once, in order", () => {
      const address = readTraceDrawerAddress({
        "drawer.open": "traceV2Details",
        "drawer.traceId": "trace-1",
        "drawer.pinnedSpans": "a,,b,a, c ",
      });

      expect(address.pinnedSpanIds).toEqual(["a", "b", "c"]);
    });
  });
});
