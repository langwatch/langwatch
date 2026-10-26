/**
 * Unit tests for the hook budget the scenario owner answers with.
 *
 * @see modules/scenario/specs/scenario-run-hooks.feature
 */

import { describe, expect, it } from "vitest";

import { hookTimeoutMsFor } from "../features/execution/scenario-hooks.ts";

describe("hookTimeoutMsFor", () => {
  describe("when the run declared a budget", () => {
    it("answers the declared budget", () => {
      expect(hookTimeoutMsFor({ declared: 5_000 })).toBe(5_000);
    });
  });

  describe("when the run declared none", () => {
    it("answers the owner's default budget", () => {
      expect(hookTimeoutMsFor({ declared: undefined })).toBe(60_000);
    });
  });
});
