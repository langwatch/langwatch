/**
 * @vitest-environment node
 * `isHumanCallerRun` reads the same metadata field the caller badge and
 * message renderer read, agreeing whether the caller was real (#8020, decision 5).
 * @see specs/features/agents/voice-agents-v1.feature
 */
import { describe, expect, it } from "vitest";

import { isHumanCallerRun } from "../caller-display";

describe("isHumanCallerRun", () => {
  describe("given metadata naming a human caller", () => {
    it("returns true", () => {
      expect(isHumanCallerRun({ langwatch: { callerKind: "human" } })).toBe(true);
    });
  });

  describe("given metadata naming a simulated caller", () => {
    it("returns false", () => {
      expect(isHumanCallerRun({ langwatch: { callerKind: "simulated" } })).toBe(false);
    });
  });

  describe("given metadata with no caller kind", () => {
    it("returns false", () => {
      expect(isHumanCallerRun({ langwatch: {} })).toBe(false);
      expect(isHumanCallerRun({})).toBe(false);
    });
  });

  describe("given no metadata", () => {
    it("returns false", () => {
      expect(isHumanCallerRun(null)).toBe(false);
      expect(isHumanCallerRun(undefined)).toBe(false);
    });
  });
});
