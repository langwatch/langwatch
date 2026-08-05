/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { fanOutTargetFromRunMetadata } from "../fan-out-target.utils";

describe("fanOutTargetFromRunMetadata", () => {
  describe("given a run that recorded both the target and its type", () => {
    it("returns the target the fan-out can inherit", () => {
      expect(
        fanOutTargetFromRunMetadata({
          langwatch: { targetReferenceId: "prompt_abc", targetType: "prompt" },
        }),
      ).toEqual({ type: "prompt", referenceId: "prompt_abc" });
    });
  });

  describe("given a run that recorded only the target reference", () => {
    /** @scenario "A run with no recorded target type still offers the entry point" */
    it("says it does not know, rather than claiming there is no target", () => {
      // Runs dispatched before the platform recorded target types land here.
      // Undefined sends the flow to the target picker; the caller must not
      // read it as "this run cannot be fanned out".
      expect(
        fanOutTargetFromRunMetadata({
          langwatch: { targetReferenceId: "prompt_abc" },
        }),
      ).toBeUndefined();
    });
  });

  describe("given a run whose recorded target type is not one we know", () => {
    it("says it does not know, rather than trusting the stored string", () => {
      // Metadata is JSON, so the declared type is a claim, not a guarantee.
      expect(
        fanOutTargetFromRunMetadata({
          langwatch: { targetReferenceId: "prompt_abc", targetType: "banana" },
        }),
      ).toBeUndefined();
    });
  });

  describe("given a run with no langwatch metadata at all", () => {
    it("says it does not know", () => {
      expect(fanOutTargetFromRunMetadata({})).toBeUndefined();
      expect(fanOutTargetFromRunMetadata(null)).toBeUndefined();
      expect(fanOutTargetFromRunMetadata(undefined)).toBeUndefined();
    });
  });
});
