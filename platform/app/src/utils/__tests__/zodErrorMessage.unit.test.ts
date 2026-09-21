import { describe, expect, it } from "vitest";
import { z as z3 } from "zod";
import { z as z4 } from "zod/v4";
import { zodErrorMessage } from "../zodErrorMessage";

/**
 * Spec: specs/api-reference/tracked-event-validation.feature
 *
 * The repo runs both zod entrypoints, and `zod-validation-error@3` throws on a
 * v4 error rather than formatting it. That TypeError escaped the catch blocks
 * meant to answer 400, so a malformed predefined event got a 500.
 */

const thumbsUpDown = z4.object({
  trace_id: z4.string(),
  event_type: z4.literal("thumbs_up_down"),
  metrics: z4.object({ vote: z4.number().min(-1).max(1) }),
});
const selectedText = z4.object({
  trace_id: z4.string(),
  event_type: z4.literal("selected_text"),
  metrics: z4.object({ text_length: z4.number() }),
});
const predefined = z4.union([thumbsUpDown, selectedText]);

const errorFrom = (parse: () => unknown): unknown => {
  try {
    parse();
  } catch (error) {
    return error;
  }
  throw new Error("expected the schema to reject the payload");
};

describe("zodErrorMessage", () => {
  describe("given a zod/v4 error from a union schema", () => {
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

  describe("given a zod/v4 error from a plain object schema", () => {
    describe("when the message is formatted", () => {
      /** @scenario A base-schema rejection keeps the wording it already had */
      it("reports each missing field with its path", () => {
        const error = errorFrom(() =>
          z4.object({ trace_id: z4.string() }).parse({}),
        );

        expect(zodErrorMessage(error)).toContain("trace_id");
      });
    });
  });

  describe("given a zod v3 error", () => {
    describe("when the message is formatted", () => {
      /** @scenario A base-schema rejection keeps the wording it already had */
      it("keeps the wording the v3 formatter already produced", () => {
        const error = errorFrom(() =>
          z3.object({ trace_id: z3.string() }).parse({}),
        );

        const message = zodErrorMessage(error);

        expect(message).toContain("Validation error");
        expect(message).toContain("trace_id");
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
