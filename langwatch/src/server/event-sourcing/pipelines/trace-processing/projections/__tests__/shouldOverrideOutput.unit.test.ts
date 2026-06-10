import { describe, it, expect } from "vitest";
import { shouldOverrideOutput } from "../services/trace-io-accumulation.service";

describe("shouldOverrideOutput", () => {
  describe("when the incoming span is the root span", () => {
    it("overrides a non-root output regardless of other factors", () => {
      expect(
        shouldOverrideOutput({
          isRoot: true,
          outputFromRoot: false,
          isExplicit: false,
          currentIsExplicit: true,
          endTime: 0,
          currentEndTime: 1000,
        }),
      ).toBe(true);
    });
  });

  // claude_code Path B turns synthesize many parentless ("root") spans under
  // one trace. Among roots the latest-finishing reply wins so the trace output
  // is deterministic, rather than whichever root happened to fold last.
  describe("when both the new and current output came from a root", () => {
    it("overrides when the new root ends later", () => {
      expect(
        shouldOverrideOutput({
          isRoot: true,
          outputFromRoot: true,
          isExplicit: false,
          currentIsExplicit: false,
          endTime: 2000,
          currentEndTime: 1000,
        }),
      ).toBe(true);
    });

    it("does not override when the new root ends earlier", () => {
      expect(
        shouldOverrideOutput({
          isRoot: true,
          outputFromRoot: true,
          isExplicit: false,
          currentIsExplicit: false,
          endTime: 500,
          currentEndTime: 1000,
        }),
      ).toBe(false);
    });
  });

  describe("when the existing output came from root", () => {
    it("does not override", () => {
      expect(
        shouldOverrideOutput({
          isRoot: false,
          outputFromRoot: true,
          isExplicit: true,
          currentIsExplicit: false,
          endTime: 2000,
          currentEndTime: 1000,
        }),
      ).toBe(false);
    });
  });

  describe("when explicit source beats inferred", () => {
    it("overrides when new is explicit and current is inferred", () => {
      expect(
        shouldOverrideOutput({
          isRoot: false,
          outputFromRoot: false,
          isExplicit: true,
          currentIsExplicit: false,
          endTime: 0,
          currentEndTime: 1000,
        }),
      ).toBe(true);
    });

    it("does not override when new is inferred and current is explicit", () => {
      expect(
        shouldOverrideOutput({
          isRoot: false,
          outputFromRoot: false,
          isExplicit: false,
          currentIsExplicit: true,
          endTime: 2000,
          currentEndTime: 1000,
        }),
      ).toBe(false);
    });
  });

  describe("when both have the same explicitness", () => {
    it("overrides when new span ends later", () => {
      expect(
        shouldOverrideOutput({
          isRoot: false,
          outputFromRoot: false,
          isExplicit: false,
          currentIsExplicit: false,
          endTime: 2000,
          currentEndTime: 1000,
        }),
      ).toBe(true);
    });

    it("does not override when new span ends earlier", () => {
      expect(
        shouldOverrideOutput({
          isRoot: false,
          outputFromRoot: false,
          isExplicit: false,
          currentIsExplicit: false,
          endTime: 500,
          currentEndTime: 1000,
        }),
      ).toBe(false);
    });

    it("overrides when end times are equal (>= semantics)", () => {
      expect(
        shouldOverrideOutput({
          isRoot: false,
          outputFromRoot: false,
          isExplicit: true,
          currentIsExplicit: true,
          endTime: 1000,
          currentEndTime: 1000,
        }),
      ).toBe(true);
    });
  });
});
