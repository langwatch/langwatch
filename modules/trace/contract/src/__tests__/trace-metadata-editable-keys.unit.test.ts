/**
 * Which of a trace's metadata keys a correction may touch, and how the drawer's
 * attribute rows and the canonical metadata keys line up.
 */
import { describe, expect, it } from "vitest";

import {
  isTraceMetadataKeyEditable,
  traceAttributeKeyForMetadata,
  mapAttributeToTraceMetadataKey,
} from "../trace-metadata-editable-keys.ts";

describe("trace metadata editable keys", () => {
  describe("given the metadata keys a trace can carry", () => {
    describe("when asking which ones a correction may replace", () => {
      /** @scenario "Which metadata keys a reviewer may correct is one rule" */
      it("refuses the keys a trace is grouped by", () => {
        expect(isTraceMetadataKeyEditable("thread_id")).toBe(false);
        expect(isTraceMetadataKeyEditable("user_id")).toBe(false);
        expect(isTraceMetadataKeyEditable("customer_id")).toBe(false);
        expect(isTraceMetadataKeyEditable("scenario.run_id")).toBe(false);
      });

      /** @scenario "Which metadata keys a reviewer may correct is one rule" */
      it("refuses everything the platform stamps itself", () => {
        expect(isTraceMetadataKeyEditable("langwatch.origin")).toBe(false);
        expect(isTraceMetadataKeyEditable("langwatch.reserved.log_record_count")).toBe(false);
      });

      /** @scenario "Which metadata keys a reviewer may correct is one rule" */
      it("allows labels and the keys the caller sent", () => {
        expect(isTraceMetadataKeyEditable("labels")).toBe(true);
        expect(isTraceMetadataKeyEditable("environment")).toBe(true);
        expect(isTraceMetadataKeyEditable("review.note")).toBe(true);
      });

      it("refuses an empty key", () => {
        expect(isTraceMetadataKeyEditable("")).toBe(false);
      });
    });
  });

  describe("given a row in the summary's metadata table", () => {
    describe("when it is a key the caller sent", () => {
      /** @scenario "Which metadata keys a reviewer may correct is one rule" */
      it("corrects the bare metadata key underneath it", () => {
        expect(mapAttributeToTraceMetadataKey("metadata.environment")).toBe("environment");
        expect(mapAttributeToTraceMetadataKey("metadata.review.note")).toBe("review.note");
      });
    });

    describe("when it is the labels row", () => {
      /** @scenario "Which metadata keys a reviewer may correct is one rule" */
      it("corrects the labels metadata key", () => {
        expect(mapAttributeToTraceMetadataKey("langwatch.labels")).toBe("labels");
      });
    });

    describe("when it describes the run rather than the trace", () => {
      /** @scenario "Which metadata keys a reviewer may correct is one rule" */
      it("corrects nothing", () => {
        expect(mapAttributeToTraceMetadataKey("service.name")).toBeNull();
        expect(mapAttributeToTraceMetadataKey("gen_ai.conversation.id")).toBeNull();
        expect(mapAttributeToTraceMetadataKey("langwatch.user_id")).toBeNull();
        expect(mapAttributeToTraceMetadataKey("scenario.run_id")).toBeNull();
        expect(mapAttributeToTraceMetadataKey("thread_id")).toBeNull();
        expect(mapAttributeToTraceMetadataKey("metadata.")).toBeNull();
      });
    });

    describe("when it is a bare key with no namespace", () => {
      /** @scenario "Which metadata keys a reviewer may correct is one rule" */
      it("corrects the key itself", () => {
        expect(mapAttributeToTraceMetadataKey("reviewed_by")).toBe("reviewed_by");
      });
    });
  });

  describe("given a corrected metadata key", () => {
    describe("when the drawer looks for the row it reads on", () => {
      /** @scenario "Which metadata keys a reviewer may correct is one rule" */
      it("finds the row it was read from", () => {
        expect(traceAttributeKeyForMetadata("environment")).toBe("metadata.environment");
        expect(traceAttributeKeyForMetadata("labels")).toBe("langwatch.labels");
      });
    });
  });
});
