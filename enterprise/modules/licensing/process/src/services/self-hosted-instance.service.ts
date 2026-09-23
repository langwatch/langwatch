/**
 * What happens to a usage report once the receiver accepted it, and how an
 * operator reads it back (ADR-156, section 10). A report presents no
 * credential, so its customer comes from the license bound to that instance.
 * @see specs/self-hosting/connected-services/instance-registry.feature
 */

import type {
  IncomingUsageReport,
  SelfHostedInstanceDetail,
  SelfHostedInstancePage,
  SelfHostedInstanceView,
  SelfHostedSignal,
} from "@langwatch/enterprise-licensing-contract";
import { nowInstant, Temporal, type Instant } from "@langwatch/time";

import type { LicenseCustomers } from "../app/licensing.members.ts";
import type { IssuedLicenseRepository } from "../repositories/issued-license.repository.ts";
import type {
  SelfHostedInstanceRecord,
  SelfHostedInstanceRepository,
} from "../repositories/self-hosted-instance.repository.ts";
import {
  carriesOptionalCategory,
  instanceActivity,
  reportFieldsOf,
} from "../rules/self-hosted-report.rules.ts";
import { signalsRaisedBy } from "../rules/self-hosted-signals.rules.ts";
import type { SelfHostedCrmService } from "./self-hosted-crm.service.ts";

/** How many history rows the drawer shows. */
const REPORT_HISTORY_LIMIT = 30;

export type SelfHostedInstanceCollaborators = Readonly<{
  repository: SelfHostedInstanceRepository;
  licenses: Pick<IssuedLicenseRepository, "findAllBoundToInstance">;
  organizations: Pick<LicenseCustomers, "findById">;
  /** Absent where nothing is listening: a signal is raised only once announced. */
  crm?: Pick<SelfHostedCrmService, "hasAccountOnDomain" | "announce">;
  /** The usage report's optional-category keys, from its field dictionary. */
  optionalReportKeys: ReadonlySet<string>;
  now?: () => Instant;
}>;

export class SelfHostedInstanceService {
  static create(collaborators: SelfHostedInstanceCollaborators): SelfHostedInstanceService {
    return new SelfHostedInstanceService(collaborators);
  }

  readonly #now: () => Instant;

  private constructor(private readonly collaborators: SelfHostedInstanceCollaborators) {
    this.#now = collaborators.now ?? nowInstant;
  }

  /** Writes the row, the history and whatever someone should hear; answers the signals raised. */
  async recordReport(report: IncomingUsageReport): Promise<SelfHostedSignal[]> {
    const { repository, licenses } = this.collaborators;
    const receivedAt = Temporal.Instant.from(report.receivedAt);
    const { instanceId, properties } = report;
    const [[previous], [owner]] = await Promise.all([
      repository.findByInstanceId(instanceId),
      licenses.findAllBoundToInstance(instanceId),
    ]);
    const fields = reportFieldsOf(properties);
    const domain = fields.leadingDomain ?? undefined;
    const alreadyRaised = previous?.raisedSignals ?? [];
    const signals = await this.signalsFor({
      report,
      firstSeenAt: previous?.firstSeenAt,
      owner,
      alreadyRaised,
      domain,
      receivedAt,
    });
    const { version, reportSchemaVersion } = fields;

    await repository.upsert({
      instanceId,
      lastSeenAt: receivedAt,
      version,
      installMethod: fields.installMethod,
      chartVersion: fields.chartVersion,
      hostname: fields.hostname,
      environment: fields.environment,
      installedAt: fields.installedAt,
      reportSchemaVersion,
      organizationId: owner?.organizationId ?? null,
      issuedLicenseId: owner?.id ?? null,
      userEmailDomains: fields.userEmailDomains,
      latestReport: properties,
      optionalMetricsReported: carriesOptionalCategory({
        properties,
        optionalKeys: this.collaborators.optionalReportKeys,
      }),
      hostnameReported: fields.hostname !== null,
      lastUnknownFields: report.unknownFields,
      raisedSignals: [...alreadyRaised, ...signals],
    });
    await repository.appendReport({
      instanceId,
      receivedAt,
      version,
      reportSchemaVersion,
      unknownFields: report.unknownFields,
      payload: properties,
    });
    await this.announce({
      signals,
      instanceId,
      domain,
      organizationId: owner?.organizationId ?? null,
    });
    return signals;
  }

  async list(input: {
    page: number;
    pageSize: number;
    search?: string;
  }): Promise<SelfHostedInstancePage> {
    const { rows, total } = await this.collaborators.repository.findPage(input);
    return { instances: await this.viewsOf(rows), total };
  }

  async getById({ id }: { id: string }): Promise<SelfHostedInstanceDetail> {
    const row = await this.collaborators.repository.getById(id);
    const [views, reports] = await Promise.all([
      this.viewsOf([row]),
      this.collaborators.repository.findReports({
        instanceId: row.instanceId,
        limit: REPORT_HISTORY_LIMIT,
      }),
    ]);
    return {
      instance: views[0] ?? viewOf({ row, organizationName: null, now: this.#now() }),
      reports: reports.map((entry) => ({ ...entry, receivedAt: entry.receivedAt.toString() })),
    };
  }

  private async signalsFor({
    report,
    firstSeenAt,
    owner,
    alreadyRaised,
    domain,
    receivedAt,
  }: {
    report: IncomingUsageReport;
    firstSeenAt: Instant | undefined;
    owner: { expiresAt: Instant; lastSyncAt: Instant | null } | undefined;
    alreadyRaised: readonly string[];
    domain: string | undefined;
    receivedAt: Instant;
  }): Promise<SelfHostedSignal[]> {
    const crm = this.collaborators.crm;
    if (!crm) return [];
    // Asked only while the answer can change anything: a raised signal is never raised again.
    const domainHasCloudAccount =
      domain !== undefined && !alreadyRaised.includes("domain_has_cloud_account")
        ? await crm.hasAccountOnDomain(domain)
        : false;
    return signalsRaisedBy({
      properties: report.properties,
      firstSeenAt,
      alreadyRaised,
      license: owner
        ? { expiresAt: owner.expiresAt, lastSyncAt: owner.lastSyncAt ?? undefined }
        : undefined,
      domainHasCloudAccount,
      now: receivedAt,
    });
  }

  /** Tells the CRM, reading the row back as it was stored. */
  private async announce({
    signals,
    instanceId,
    domain,
    organizationId,
  }: {
    signals: readonly SelfHostedSignal[];
    instanceId: string;
    domain: string | undefined;
    organizationId: string | null;
  }): Promise<void> {
    const crm = this.collaborators.crm;
    if (signals.length === 0 || !crm) return;
    const [stored] = await this.collaborators.repository.findByInstanceId(instanceId);
    if (!stored) return;
    await crm.announce({ signals, instance: stored, leadingDomain: domain, organizationId });
  }

  private async viewsOf(rows: SelfHostedInstanceRecord[]): Promise<SelfHostedInstanceView[]> {
    const now = this.#now();
    const organizationIds = [
      ...new Set(rows.flatMap((row) => (row.organizationId ? [row.organizationId] : []))),
    ];
    const organizations = await Promise.all(
      organizationIds.map((id) => this.collaborators.organizations.findById(id)),
    );
    const names = new Map(
      organizations.flatMap((organization) =>
        organization ? [[organization.id, organization.name] as const] : [],
      ),
    );
    return rows.map((row) =>
      viewOf({
        row,
        organizationName: row.organizationId ? (names.get(row.organizationId) ?? null) : null,
        now,
      }),
    );
  }
}

function viewOf({
  row,
  organizationName,
  now,
}: {
  row: SelfHostedInstanceRecord;
  organizationName: string | null;
  now: Instant;
}): SelfHostedInstanceView {
  return {
    ...row,
    firstSeenAt: row.firstSeenAt.toString(),
    lastSeenAt: row.lastSeenAt.toString(),
    installedAt: row.installedAt?.toString() ?? null,
    organizationName,
    activity: instanceActivity({ lastSeenAt: row.lastSeenAt, now }),
  };
}
