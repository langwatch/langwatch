// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/** @vitest-environment node */
// Owed port, listed in dev/docs/plans/merge-2026-09-21-owed-ports.md; main's file is
// ee/governance/services/pullers/__tests__/pulledUsageRerun.integration.test.ts
import { describe, it } from "vitest";

describe("given a read that recorded part of a period and then failed", () => {
  describe("when a later read covers that period again from the start", () => {
    /** @scenario "Restarting after a read that stopped halfway does not record the spend twice" */
    it.todo("counts each day once, at the figure the provider reported");
  });
});
