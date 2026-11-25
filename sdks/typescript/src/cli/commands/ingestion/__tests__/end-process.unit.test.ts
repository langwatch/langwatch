/**
 * The one-shot ingestion process ends itself with exit code zero, whatever its work does.
 * Feature: specs/ai-governance/cli-wrappers/session-context-hook.feature
 */

import { describe, expect, it } from "vitest";

import { endProcessWhenDone } from "../end-process";

describe("endProcessWhenDone()", () => {
  describe("given work that fails before it posts anything", () => {
    /** @scenario "The hook process ends with exit code zero when its work fails" */
    it("ends the process itself with exit code zero", async () => {
      const exits: number[] = [];

      await endProcessWhenDone({
        work: () => Promise.reject(new Error("the state directory could not be resolved")),
        budgetMs: 60_000,
        exit: (code) => exits.push(code),
      });

      expect(exits).toEqual([0]);
    });
  });
});
