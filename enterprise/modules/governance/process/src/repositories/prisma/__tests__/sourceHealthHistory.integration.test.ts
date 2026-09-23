/** @vitest-environment node */

// Owed port, listed in dev/docs/plans/merge-2026-09-21-owed-ports.md; main's file is
// ee/governance/services/activity-monitor/__tests__/sourceHealthHistory.integration.test.ts
import { describe, it } from "vitest";

describe("source health during a historical provider import", () => {
  it.todo(
    "keeps %s counts at zero while reporting the newest historical event, scoped to this source and tenant",
  );
});
