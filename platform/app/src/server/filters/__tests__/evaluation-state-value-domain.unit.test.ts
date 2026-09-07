import { describe, expect, it } from "vitest";
import { evaluationRunDataSchema } from "~/server/app-layer/evaluations/types";
import {
  sanitizeTriggerFilters,
  triggerFiltersPermissiveSchema,
  triggerFiltersSchema,
} from "../types";

/**
 * The canonical execution-state domain, derived from the schema so this
 * suite cannot go stale relative to it (an enum change here fails these
 * tests until the new state is accounted for).
 */
const CANONICAL_STATUS_VALUES = evaluationRunDataSchema.shape.status.options;

describe("triggerFiltersSchema", () => {
  describe("given an evaluations.state filter", () => {
    describe("when the stored value is a non-canonical phantom", () => {
      it("rejects the input", () => {
        const result = triggerFiltersSchema.safeParse({
          "evaluations.state": { "eval-abc": ["Error_Message"] },
        });

        expect(result.success).toBe(false);
      });
    });

    describe("when the array mixes a canonical value with a phantom", () => {
      it("rejects the input instead of partially accepting it", () => {
        const result = triggerFiltersSchema.safeParse({
          "evaluations.state": { "eval-abc": ["error", "Error_Message"] },
        });

        expect(result.success).toBe(false);
      });
    });

    describe("when the value is one of the canonical execution states", () => {
      for (const status of CANONICAL_STATUS_VALUES) {
        it(`accepts "${status}"`, () => {
          const result = triggerFiltersSchema.safeParse({
            "evaluations.state": { "eval-abc": [status] },
          });

          expect(result.success).toBe(true);
        });
      }
    });
  });

  describe("given filters that do not use evaluations.state", () => {
    describe("when other fields hold values shaped like the phantom", () => {
      it("still accepts them", () => {
        // filterValueSchema is field-agnostic and shared across every filter
        // field. A domain guard keyed on the wrong thing (e.g. a substring
        // match on the value, or on "evaluations.") would break this.
        const result = triggerFiltersSchema.safeParse({
          "metadata.value": { reason: ["Error_Message", "anything"] },
          "evaluations.label": { e1: ["failed"] },
          "topics.topics": ["billing"],
          "events.event_details.key": { ev1: { k: ["v"] } },
        });

        expect(result.success).toBe(true);
      });
    });
  });
});

describe("triggerFiltersPermissiveSchema", () => {
  describe("given an evaluations.state filter", () => {
    describe("when the stored value is a non-canonical phantom", () => {
      it("rejects the input", () => {
        const result = triggerFiltersPermissiveSchema.safeParse({
          "evaluations.state": { "eval-abc": ["Error_Message"] },
        });

        expect(result.success).toBe(false);
      });
    });
  });
});

describe("sanitizeTriggerFilters", () => {
  describe("given an evaluations.state filter", () => {
    describe("when the stored value is a non-canonical phantom", () => {
      it("does not let the phantom survive into the sanitized output", () => {
        const { sanitized } = sanitizeTriggerFilters({
          "evaluations.state": { "eval-abc": ["Error_Message"] },
        });

        expect(JSON.stringify(sanitized)).not.toContain("Error_Message");
      });
    });
  });
});
