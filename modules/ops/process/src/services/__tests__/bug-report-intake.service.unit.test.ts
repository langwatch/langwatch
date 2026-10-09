/**
 * @vitest-environment node
 * The report intake's per-caller allowance, over the memory twins.
 * @see modules/ops/specs/bug-report-intake-limit.feature
 */
import type { ApiKeyApi } from "@langwatch/api-key-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { MemoryBugReportRateLimitRepository } from "../../repositories/memory/memory.bug-report-rate-limit.repository.ts";
import { MemoryBugReportRepository } from "../../repositories/memory/memory.bug-report.repository.ts";
import { MemoryOpsStore } from "../../repositories/memory/memory.ops.store.ts";
import { BugReportIntakeService } from "../bug-report-intake.service.ts";

const flooder = "203.0.113.7";

function intake(): {
  reports: MemoryBugReportRepository;
  submit: (callerKey: string) => Promise<{ id: string }>;
} {
  const reports = MemoryBugReportRepository.create({ store: MemoryOpsStore.create() });
  const service = BugReportIntakeService.create({
    reports,
    rateLimiter: MemoryBugReportRateLimitRepository.create(),
    notifier: { notify: () => Promise.resolve() },
  });
  const submit = (callerKey: string): Promise<{ id: string }> =>
    service.submit({
      input: { source: "cli", kind: "summary", title: "The CLI could not reach the API" },
      callerKey,
      apiKeys: createApiFixture<ApiKeyApi>(),
    });
  return { reports, submit };
}

describe("given the bug report intake", () => {
  describe("when a caller sends an eleventh report within the hour", () => {
    /** @scenario "A caller past the hourly allowance is refused" */
    it("refuses it with the rate-limit error and stores only the first ten", async () => {
      const { reports, submit } = intake();
      for (let sent = 0; sent < 10; sent++) await submit(flooder);

      await expect(submit(flooder)).rejects.toMatchObject({ code: "agent_report_rate_limited" });
      expect(await reports.count()).toBe(10);
    });
  });

  describe("when another caller sends a report after the first used up the allowance", () => {
    /** @scenario "Another caller keeps their own allowance" */
    it("stores it", async () => {
      const { reports, submit } = intake();
      for (let sent = 0; sent < 10; sent++) await submit(flooder);
      await expect(submit(flooder)).rejects.toMatchObject({ code: "agent_report_rate_limited" });

      await submit("198.51.100.4");

      expect(await reports.count()).toBe(11);
    });
  });
});
