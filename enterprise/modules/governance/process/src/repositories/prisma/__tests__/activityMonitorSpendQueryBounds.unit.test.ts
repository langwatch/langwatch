// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

// Owed port, listed in dev/docs/plans/merge-2026-09-21-owed-ports.md; main's file is
// ee/governance/services/activity-monitor/__tests__/activityMonitorSpendQueryBounds.unit.test.ts
import { describe, it } from "vitest";

describe("ActivityMonitorSpendClickHouseRepository query bounds", () => {
  describe("when a spend read is issued (#8072 step 2: closed upper bound)", () => {
    it.todo("${read.name} binds the upper end of the time range");
    it.todo("${read.name} pushes the upper bound into the dedup subquery too");
  });
  describe("when a spend read is issued (#8072 step 3: query execution ceiling)", () => {
    it.todo("${read.name} caps execution time and thread count");
  });
});
