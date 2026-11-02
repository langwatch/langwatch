// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Cloud's intake of upgrade diagnostics, over the memory twins.
 * Spec: enterprise/modules/licensing/specs/upgrade-diagnostics.feature
 */
import { Temporal, type Instant } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { upgradeDiagnosticsSubmission } from "../../__tests__/support/upgrade-diagnostics.fixture.ts";
import { MemoryUpgradeDiagnosticsAnnouncementChannel } from "../../channels/memory/memory.upgrade-diagnostics-announcement.channel.ts";
import { MemoryLicensingRateLimitRepository } from "../../repositories/memory/memory.licensing-rate-limit.repository.ts";
import { MemorySelfHostedInstanceRepository } from "../../repositories/memory/memory.self-hosted-instance.repository.ts";
import { MemoryUpgradeDiagnosticBundleRepository } from "../../repositories/memory/memory.upgrade-diagnostic-bundle.repository.ts";
import { MemoryUpgradeDiagnosticRepository } from "../../repositories/memory/memory.upgrade-diagnostic.repository.ts";
import { UPGRADE_DIAGNOSTICS_LIMIT } from "../../rules/upgrade-diagnostics.rules.ts";
import { UpgradeDiagnosticsService } from "../upgrade-diagnostics.service.ts";

const START = Temporal.Instant.from("2026-10-20T10:00:00Z");
const caller = {
  licenseRowId: "license-1",
  organizationId: "org-1",
  instanceId: "install-1",
  virtualKeyId: "vk-1",
};

async function setup({ refuseSlack }: { refuseSlack?: boolean } = {}) {
  const repository = MemoryUpgradeDiagnosticRepository.create();
  const bundles = MemoryUpgradeDiagnosticBundleRepository.create();
  const instances = MemorySelfHostedInstanceRepository.create();
  const rateLimits = MemoryLicensingRateLimitRepository.create();
  const announcements = MemoryUpgradeDiagnosticsAnnouncementChannel.create(
    refuseSlack ? { refuse: new Error("slack is down") } : {},
  );
  await instances.upsert({
    instanceId: "install-1",
    lastSeenAt: START,
    version: "3.23.0",
    installMethod: "helm",
    chartVersion: null,
    hostname: null,
    environment: null,
    installedAt: null,
    reportSchemaVersion: 2,
    organizationId: "org-1",
    issuedLicenseId: null,
    userEmailDomains: null,
    latestReport: {},
    optionalMetricsReported: true,
    hostnameReported: false,
    lastUnknownFields: 0,
    raisedSignals: [],
  });
  const [instance] = await instances.findByInstanceId("install-1");
  let clock: Instant = START;
  let ids = 0;
  const errors: string[] = [];
  const service = UpgradeDiagnosticsService.create({
    repository,
    bundles,
    instances,
    organizations: {
      findById: async (id) => (id === "org-1" ? { id, name: "Acme Robotics" } : null),
    },
    rateLimit: {
      allow: async ({ instanceId }) =>
        (await rateLimits.check(`upgrade_diagnostics:${instanceId}`, UPGRADE_DIAGNOSTICS_LIMIT))
          .allowed,
    },
    announcements,
    baseUrl: "https://app.langwatch.test",
    newReportId: () => `report-${++ids}`,
    now: () => clock,
    logger: { error: (_fields, message) => errors.push(message) },
  });
  return {
    service,
    repository,
    bundles,
    announcements,
    errors,
    instanceRowId: instance?.id ?? "",
    advance: (minutes: number) => {
      clock = clock.add({ minutes });
    },
  };
}

describe("UpgradeDiagnosticsService", () => {
  describe("when a verified licence caller records a submission", () => {
    /** @scenario "Cloud stores a received bundle and files a report row" */
    it("writes the bundle under the instance's prefix and files a row with a 30-day expiry", async () => {
      const { service, repository, bundles } = await setup();
      const submission = upgradeDiagnosticsSubmission();

      const receipt = await service.record({ caller, submission });

      expect(receipt).toEqual({ reportId: "report-1", receivedAt: "2026-10-20T10:00:00Z" });
      const key = "upgrade-diagnostics/install-1/report-1.json";
      const stored = bundles.objects.get(key);
      expect(JSON.parse(new TextDecoder().decode(stored))).toEqual(submission);
      expect(repository.rows).toHaveLength(1);
      expect(repository.rows[0]).toMatchObject({
        instanceId: "install-1",
        stepId: "trace:backfill-span-costs",
        release: "3.23.0",
        attempt: 1,
        trigger: "automatic",
        byteLength: stored?.byteLength,
        objectKey: key,
      });
      expect(repository.rows[0]?.expiresAt.toString()).toBe("2026-11-19T10:00:00Z");
    });
  });

  describe("when an instance already sent its daily allowance", () => {
    /** @scenario "Cloud refuses an install that sends too many bundles in a day" */
    it("refuses the next one as upgrade_diagnostics_rate_limited and stores nothing", async () => {
      const { service, repository } = await setup();
      for (let sent = 0; sent < UPGRADE_DIAGNOSTICS_LIMIT.requests; sent++) {
        await service.record({ caller, submission: upgradeDiagnosticsSubmission() });
      }

      await expect(
        service.record({ caller, submission: upgradeDiagnosticsSubmission() }),
      ).rejects.toMatchObject({ code: "upgrade_diagnostics_rate_limited" });
      expect(repository.rows).toHaveLength(UPGRADE_DIAGNOSTICS_LIMIT.requests);
    });
  });

  describe("when the first report of a step and release arrives", () => {
    /** @scenario "The first report of a step and release posts one metadata-only Slack message" */
    it("posts one message with the metadata and the admin link, and no error text or log lines", async () => {
      const { service, announcements, instanceRowId } = await setup();

      await service.record({ caller, submission: upgradeDiagnosticsSubmission({}, "operator") });

      expect(announcements.posts).toHaveLength(1);
      const posted = JSON.stringify(announcements.posts[0]);
      for (const shown of [
        "install-1",
        "Acme Robotics",
        "3.23.0",
        "trace:backfill-span-costs",
        "Fills the cost of every span",
        "by the operator",
        `https://app.langwatch.test/ops/cloud/self-hosted-instances?instance=${instanceRowId}`,
      ]) {
        expect(posted).toContain(shown);
      }
      expect(posted).not.toContain("does not exist");
      expect(posted).not.toContain("started");
    });
  });

  describe("when a later attempt of an announced step arrives", () => {
    /** @scenario "A later report of the same step and release posts nothing more" */
    it("posts nothing more, and a new release announces again", async () => {
      const { service, announcements, advance } = await setup();
      await service.record({ caller, submission: upgradeDiagnosticsSubmission() });
      advance(60);

      await service.record({ caller, submission: upgradeDiagnosticsSubmission({ attempt: 2 }) });
      expect(announcements.posts).toHaveLength(1);

      await service.record({
        caller,
        submission: upgradeDiagnosticsSubmission({ release: "3.24.0" }),
      });
      expect(announcements.posts).toHaveLength(2);
    });
  });

  describe("when Slack refuses every post", () => {
    /** @scenario "A failed Slack post does not fail the receipt" */
    it("still answers the receipt and logs the failure", async () => {
      const { service, repository, errors } = await setup({ refuseSlack: true });

      await expect(
        service.record({ caller, submission: upgradeDiagnosticsSubmission() }),
      ).resolves.toMatchObject({ reportId: "report-1" });
      expect(repository.rows).toHaveLength(1);
      expect(errors).toEqual(["failed to post an upgrade diagnostics report to Slack"]);
    });
  });

  describe("when Cloud admin lists an instance's reports", () => {
    /** @scenario "Cloud admin lists an instance's reports newest first" */
    it("answers every report of that instance, the newest first", async () => {
      const { service, advance, instanceRowId } = await setup();
      await service.record({ caller, submission: upgradeDiagnosticsSubmission() });
      advance(60);
      await service.record({ caller, submission: upgradeDiagnosticsSubmission({ attempt: 2 }) });

      const reports = await service.findForInstance({ instanceRowId });

      expect(reports.map((report) => [report.id, report.attempt])).toEqual([
        ["report-2", 2],
        ["report-1", 1],
      ]);
      expect(reports[0]).toMatchObject({
        receivedAt: "2026-10-20T11:00:00Z",
        expiresAt: "2026-11-19T11:00:00Z",
      });
    });
  });

  describe("when Cloud admin downloads a report", () => {
    /** @scenario "Cloud admin downloads a report through a five-minute link" */
    it("answers a link signed for five minutes", async () => {
      const { service } = await setup();
      await service.record({ caller, submission: upgradeDiagnosticsSubmission() });

      const download = await service.getDownload({ id: "report-1" });

      expect(download.expiresAt).toBe("2026-10-20T10:05:00Z");
      expect(download.url).toContain("upgrade-diagnostics/install-1/report-1.json");
      expect(download.url).toContain("2026-10-20T10:05:00Z");
    });

    /** @scenario "Downloading an unknown report is refused by name" */
    it("refuses an unknown id as upgrade_diagnostics_not_found", async () => {
      const { service } = await setup();

      await expect(service.getDownload({ id: "missing" })).rejects.toMatchObject({
        code: "upgrade_diagnostics_not_found",
      });
    });
  });

  describe("when a report is past its 30 days", () => {
    /** @scenario "A report past its 30 days is no longer listed or downloadable" */
    it("leaves it out of the list and refuses its download", async () => {
      const { service, advance, instanceRowId } = await setup();
      await service.record({ caller, submission: upgradeDiagnosticsSubmission() });
      advance(30 * 24 * 60);

      await expect(service.findForInstance({ instanceRowId })).resolves.toEqual([]);
      await expect(service.getDownload({ id: "report-1" })).rejects.toMatchObject({
        code: "upgrade_diagnostics_not_found",
      });
    });
  });
});
