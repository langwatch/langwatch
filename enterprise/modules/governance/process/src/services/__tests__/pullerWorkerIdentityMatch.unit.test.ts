// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

// Owed port, listed in dev/docs/plans/merge-2026-09-21-owed-ports.md; main's file is
// ee/governance/services/pullers/__tests__/pullerWorkerIdentityMatch.unit.test.ts
import { describe, it } from "vitest";

describe("the pull run's identity-match seam", () => {
  describe("when a delivery discovers at least one person", () => {
    /** @scenario "Suggestions are recomputed when the feed discovers people" */
    it.todo(
      "hands the organization to the injected matcher, once, after the delivery's own writes",
    );
    it.todo("still delivers the run when the matcher throws");
  });
  describe("when the delivery discovers nobody", () => {
    it.todo("never invokes the matcher — an empty feed is not a trigger");
  });
  describe("when no matcher is composed", () => {
    it.todo("the run completes as it always did — the port is optional");
  });
});
