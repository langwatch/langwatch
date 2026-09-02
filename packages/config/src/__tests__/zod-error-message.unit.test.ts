import { describe, expect, it } from "vitest";
import { z } from "zod";
import { zodErrorMessage } from "../zod-error-message";

/**
 * Spec: specs/api-reference/tracked-event-validation.feature
 *
 * A formatter must never throw from inside the catch block that is turning a
 * malformed predefined event into a useful 400 response.
 */

const thumbsUpDown = z.object({
  trace_id: z.string(),
  event_type: z.literal("thumbs_up_down"),
  metrics: z.object({ vote: z.number().min(-1).max(1) }),
});
const selectedText = z.object({
  trace_id: z.string(),
  event_type: z.literal("selected_text"),
  metrics: z.object({ text_length: z.number() }),
});
const predefined = z.union([thumbsUpDown, selectedText]);

const errorFrom = (parse: () => unknown): unknown => {
  try {
    parse();
  } catch (error) {
    return error;
  }
  throw new Error("expected the schema to reject the payload");
};

describe("zodErrorMessage", () => {
  describe("given a Zod error from a union schema", () => {
    describe("when the message is formatted", () => {
      /** @scenario A rejected predefined event names the offending field */
      it("names the field that was rejected", () => {
        const error = errorFrom(() =>
          predefined.parse({
            trace_id: "trace_123",
            event_type: "thumbs_up_down",
            metrics: { vote: 2 },
          }),
        );

        const message = zodErrorMessage(error);

        // `z.prettifyError` alone renders "Invalid input" for a union and
        // drops the branch issues, which is what left the caller with a 500
        // and no field name.
        expect(message).toContain("vote");
        expect(message).toContain("metrics.vote");
      });

      /** @scenario Formatting a validation failure never throws */
      it("does not throw the way fromZodError does", () => {
        const error = errorFrom(() =>
          predefined.parse({
            trace_id: "trace_123",
            event_type: "thumbs_up_down",
            metrics: { vote: 2 },
          }),
        );

        expect(() => zodErrorMessage(error)).not.toThrow();
      });
    });
  });

  describe("given a Zod error from a plain object schema", () => {
    describe("when the message is formatted", () => {
      /** @scenario A base-schema rejection keeps the wording it already had */
      it("reports each missing field with its path", () => {
        const error = errorFrom(() => z.object({ trace_id: z.string() }).parse({}));

        expect(zodErrorMessage(error)).toContain("trace_id");
      });
    });
  });

  describe("given something that is not a ZodError at all", () => {
    describe("when the message is formatted", () => {
      /** @scenario A non-validation error is still formatted as a message */
      it("still produces a string rather than throwing", () => {
        expect(typeof zodErrorMessage(new Error("boom"))).toBe("string");
      });
    });
  });
});
