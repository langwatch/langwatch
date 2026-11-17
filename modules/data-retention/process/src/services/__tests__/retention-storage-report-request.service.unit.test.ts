/**
 * The daily report and the hand-run task each send one measure command per organization.
 * @see specs/billing/retention-storage-billing.feature
 */
import { describe, expect, it } from "vitest";

import type { ReportRetentionStorageCommandData } from "../../eventing/retention-storage-report.events.ts";
import { RetentionStorageReportTask } from "../../tasks/retention-storage-report.task.ts";
import { RetentionStorageReportRequestService } from "../retention-storage-report-request.service.ts";

const NOW = Date.UTC(2026, 10, 15, 23, 59);

function setup({
  organizations = ["organization-1", "organization-2"],
  failFor = [],
}: { organizations?: string[]; failFor?: string[] } = {}) {
  const sent: ReportRetentionStorageCommandData[] = [];
  const requests = RetentionStorageReportRequestService.create({
    organizations: { findOrganizationIds: async () => organizations },
    now: () => NOW,
  });
  requests.connect(async (data) => {
    if (failFor.includes(data.organizationId)) throw new Error("the queue is down");
    sent.push(data);
  });
  return { requests, sent };
}

const commandFor = (organizationId: string): ReportRetentionStorageCommandData => ({
  tenantId: organizationId,
  organizationId,
  day: "2026-11-15",
  occurredAt: NOW,
});

describe("RetentionStorageReportRequestService", () => {
  describe("when the daily report wakes for two organizations", () => {
    /** @scenario "The daily wake asks for one measurement per organization" */
    it("sends one measure command per organization, for the wake's UTC day", async () => {
      const { requests, sent } = setup();

      const outcome = await requests.requestAll({ at: NOW });

      expect(outcome).toEqual({ requested: 2, failed: 0 });
      expect(sent).toEqual([commandFor("organization-1"), commandFor("organization-2")]);
    });
  });

  describe("when one organization's command cannot be sent", () => {
    /** @scenario "One organization failing does not stop the daily report" */
    it("still sends the other and counts the failure", async () => {
      const { requests, sent } = setup({ failFor: ["organization-1"] });

      const outcome = await requests.requestAll({ at: NOW });

      expect(outcome).toEqual({ requested: 1, failed: 1 });
      expect(sent).toEqual([commandFor("organization-2")]);
    });
  });

  describe("given the pipeline is not registered yet", () => {
    it("refuses to send", async () => {
      const requests = RetentionStorageReportRequestService.create({
        organizations: { findOrganizationIds: async () => [] },
      });

      await expect(
        requests.requestOrganization({ organizationId: "organization-1" }),
      ).rejects.toThrow("used before its pipeline");
    });
  });
});

describe("RetentionStorageReportTask", () => {
  describe("when an operator runs it for one organization", () => {
    /** @scenario "The hand-run report sends the same measure command" */
    it("sends that organization's measure command for today", async () => {
      const { requests, sent } = setup();
      const task = RetentionStorageReportTask.create({
        requests: {
          requestRetentionStorageReport: (input) =>
            input.organizationId
              ? requests.requestOrganization({ organizationId: input.organizationId })
              : requests.requestAll(),
        },
      });

      await task.run({ args: ["organization-1"], signal: new AbortController().signal });

      expect(sent).toEqual([commandFor("organization-1")]);
    });
  });
});
