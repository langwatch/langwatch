// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/** @vitest-environment node */
// Owed port, listed in dev/docs/plans/merge-2026-09-21-owed-ports.md; main's file is
// ee/governance/services/pullers/__tests__/pulledRowGovernanceHome.integration.test.ts
import { describe, it } from "vitest";

describe("a pulled usage record arriving from a provider source", () => {
  describe("given an organization with a connected provider source", () => {
    /** @scenario "A pulled row gets the organization's governance home on arrival" */
    it.todo(
      "stores the row under the governance home and attributes the money to the source's team",
    );
    /** @scenario "The organization has exactly one governance home, created when absent" */
    it.todo("mints one home per organization, and pulling again mints no second");
  });
});
