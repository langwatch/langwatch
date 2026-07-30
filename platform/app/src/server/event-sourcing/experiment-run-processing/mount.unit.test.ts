import { validateMount } from "@langwatch/event-sourcing";
import { describe, expect, it } from "vitest";
import {
  assertExperimentRunProcessingMountsAreLegal,
  experimentRunResultStorageMount,
  experimentRunStateMount,
} from "./mount";

describe("experiment-run-processing mounts (ADR-106)", () => {
  describe("experimentRunState (fold)", () => {
    it("is a legal fold mount", () => {
      expect(validateMount(experimentRunStateMount)).toEqual([]);
    });
  });

  describe("experimentRunResultStorage (map)", () => {
    it("is a legal map mount", () => {
      expect(validateMount(experimentRunResultStorageMount)).toEqual([]);
    });
  });

  describe("assertExperimentRunProcessingMountsAreLegal", () => {
    it("does not throw for this pipeline's declared mounts", () => {
      expect(() => assertExperimentRunProcessingMountsAreLegal()).not.toThrow();
    });
  });
});
