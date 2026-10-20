// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The hosted end of upgrade diagnostics on LangWatch Cloud: the bundle in object storage, a row
 * Cloud admin lists, and one metadata-only Slack message per instance, step and release.
 * Plan: dev/docs/plans/upgrade-diagnostics-via-connect.md
 */
import {
  UPGRADE_DIAGNOSTICS_RETENTION_DAYS,
  UpgradeDiagnosticsRateLimitedError,
  type ConnectLicenceCaller,
  type UpgradeDiagnosticsDownload,
  type UpgradeDiagnosticsReceipt,
  type UpgradeDiagnosticsReport,
  type UpgradeDiagnosticsSubmission,
} from "@langwatch/enterprise-licensing-contract";
import { upgradeDiagnosticsNotice } from "@langwatch/internal-slack";
import type { Instant } from "@langwatch/time";

import type { UpgradeDiagnosticsAnnouncementChannel } from "../channels/upgrade-diagnostics-announcement.channel.ts";
import type { SelfHostedInstanceRepository } from "../repositories/self-hosted-instance.repository.ts";
import type { UpgradeDiagnosticBundleRepository } from "../repositories/upgrade-diagnostic-bundle.repository.ts";
import type {
  UpgradeDiagnosticRecord,
  UpgradeDiagnosticRepository,
} from "../repositories/upgrade-diagnostic.repository.ts";
import {
  selfHostedInstanceAdminUrl,
  UPGRADE_DIAGNOSTICS_DOWNLOAD_MINUTES,
} from "../rules/upgrade-diagnostics.rules.ts";
import type { LicenseLogger } from "./license.service.ts";

type UpgradeDiagnosticsCollaborators = Readonly<{
  repository: UpgradeDiagnosticRepository;
  bundles: UpgradeDiagnosticBundleRepository;
  instances: Pick<SelfHostedInstanceRepository, "findByInstanceId" | "getById">;
  organizations: { findById(id: string): Promise<{ id: string; name: string } | null> };
  /** Licensing's own limiter, per instance (the REST limit counts per organisation). */
  rateLimit: { allow(input: { instanceId: string }): Promise<boolean> };
  /** Absent where no Slack channel is configured: the report is stored and listed only. */
  announcements?: UpgradeDiagnosticsAnnouncementChannel;
  /** Cloud's own origin, for the admin link. */
  baseUrl: string;
  newReportId: () => string;
  now: () => Instant;
  logger?: LicenseLogger;
}>;

export class UpgradeDiagnosticsService {
  static create(collaborators: UpgradeDiagnosticsCollaborators): UpgradeDiagnosticsService {
    return new UpgradeDiagnosticsService(collaborators);
  }

  private constructor(private readonly collaborators: UpgradeDiagnosticsCollaborators) {}

  /** Stores one bundle from the install the door verified; Slack never fails the receipt. */
  async record({
    caller,
    submission,
  }: {
    caller: ConnectLicenceCaller;
    submission: UpgradeDiagnosticsSubmission;
  }): Promise<UpgradeDiagnosticsReceipt> {
    const { repository, bundles, rateLimit } = this.collaborators;
    const { instanceId } = caller;
    if (!(await rateLimit.allow({ instanceId }))) throw new UpgradeDiagnosticsRateLimitedError();

    const reportId = this.collaborators.newReportId();
    const receivedAt = this.collaborators.now();
    const body = new TextEncoder().encode(JSON.stringify(submission));
    const { objectKey } = await bundles.write({ instanceId, reportId, body });
    const { step } = submission.bundle;
    const row = {
      id: reportId,
      instanceId,
      stepId: step.id,
      stepDescription: step.description,
      release: step.release,
      attempt: step.attempt,
      trigger: submission.trigger,
      byteLength: body.byteLength,
      objectKey,
      receivedAt,
      expiresAt: receivedAt.add({ hours: UPGRADE_DIAGNOSTICS_RETENTION_DAYS * 24 }),
    };
    await repository.insert(row);
    await this.announce({ row: { ...row, slackAnnouncedAt: null }, caller }).catch((error) => {
      this.collaborators.logger?.error(
        { error, instanceId, stepId: step.id },
        "failed to post an upgrade diagnostics report to Slack",
      );
    });
    return { reportId, receivedAt: receivedAt.toString() };
  }

  /** Every report of the instance behind one Cloud admin row, newest first. */
  async findForInstance({
    instanceRowId,
  }: {
    instanceRowId: string;
  }): Promise<UpgradeDiagnosticsReport[]> {
    const instance = await this.collaborators.instances.getById(instanceRowId);
    const rows = await this.collaborators.repository.findAllByInstanceId(instance.instanceId);
    return rows.map(reportOf);
  }

  async getDownload({ id }: { id: string }): Promise<UpgradeDiagnosticsDownload> {
    const row = await this.collaborators.repository.getById(id);
    const expiresAt = this.collaborators
      .now()
      .add({ minutes: UPGRADE_DIAGNOSTICS_DOWNLOAD_MINUTES });
    const url = await this.collaborators.bundles.signDownload({
      objectKey: row.objectKey,
      expiresAt,
    });
    return { url, expiresAt: expiresAt.toString() };
  }

  /** The first report of a step and release posts; a later one is listed in Cloud admin only. */
  private async announce({
    row,
    caller,
  }: {
    row: UpgradeDiagnosticRecord;
    caller: ConnectLicenceCaller;
  }): Promise<void> {
    const { announcements, repository, instances, organizations, baseUrl } = this.collaborators;
    if (!announcements) return;
    const reports = await repository.findAllForStep(row);
    if (reports.some((report) => report.slackAnnouncedAt !== null)) return;
    const [[instance], organization] = await Promise.all([
      instances.findByInstanceId(row.instanceId),
      organizations.findById(caller.organizationId),
    ]);
    const first = reports[0]?.receivedAt ?? row.receivedAt;
    await announcements.post(
      upgradeDiagnosticsNotice.render({
        props: {
          instanceId: row.instanceId,
          organizationName: organization?.name ?? null,
          release: row.release,
          stepId: row.stepId,
          stepDescription: row.stepDescription,
          attempt: row.attempt,
          trigger: row.trigger,
          firstReportAt: first.epochMilliseconds,
          latestReportAt: row.receivedAt.epochMilliseconds,
          instanceUrl: selfHostedInstanceAdminUrl({
            baseUrl,
            instanceRowId: instance?.id ?? null,
          }),
        },
        origin: { environment: new URL(baseUrl).host, sentAt: row.receivedAt.epochMilliseconds },
      }),
    );
    await repository.markAnnounced({ id: row.id, at: row.receivedAt });
  }
}

function reportOf(row: UpgradeDiagnosticRecord): UpgradeDiagnosticsReport {
  return {
    id: row.id,
    instanceId: row.instanceId,
    stepId: row.stepId,
    stepDescription: row.stepDescription,
    release: row.release,
    attempt: row.attempt,
    trigger: row.trigger,
    byteLength: row.byteLength,
    receivedAt: row.receivedAt.toString(),
    expiresAt: row.expiresAt.toString(),
  };
}
