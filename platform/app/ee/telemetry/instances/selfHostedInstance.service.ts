/**
 * What happens to a usage report once the receiver has accepted it, and how an
 * operator reads it back (ADR-139, section 10).
 *
 * The report presents no credential. That is deliberate, and it is what bounds
 * this service: a report identifies an install and never a customer. The
 * organization and the license on an install's row are resolved here from the
 * license bound to that instance, which the install proved by presenting its
 * token to license sync. No field of the posted body ever reaches them, so a
 * report cannot claim a company it does not hold a credential for.
 *
 * @see specs/self-hosting/connected-services/instance-registry.feature
 */

import { usageFieldsOfCategory } from "~/server/usage-report/dictionary";
import type { SelfHostedCrm } from "../crm/selfHostedCrm";
import {
  type SelfHostedSignal,
  signalsRaisedBy,
} from "../crm/selfHostedSignals";
import {
  type IncomingReport,
  type InstanceOwnerLookup,
  instanceActivity,
  type OrganizationNameLookup,
  type ReportProperties,
  type SelfHostedInstanceRecord,
  type SelfHostedInstanceRepository,
  type SelfHostedInstanceView,
} from "./selfHostedInstances";

/** How many history rows the drawer shows. */
const REPORT_HISTORY_LIMIT = 30;

/**
 * The optional keys, held once. A report carrying none of them came from an
 * install with the category switched off, which is read from what arrived
 * rather than from a field the sender could set either way.
 */
const OPTIONAL_KEYS: ReadonlySet<string> = new Set(
  usageFieldsOfCategory("optional").map((field) => field.key),
);

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function whole(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function day(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Domains with counts, or null on a report that carried none. */
function domains(value: unknown): Record<string, number> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const counts: Record<string, number> = {};
  for (const [domain, count] of Object.entries(value)) {
    if (typeof count === "number" && Number.isFinite(count)) {
      counts[domain] = count;
    }
  }
  return Object.keys(counts).length > 0 ? counts : null;
}

/**
 * The domain the largest share of an install's users are on, which is the one
 * that names the company. The rest are contractors, personal addresses and
 * whoever else has an account.
 */
function largestDomain(counts: Record<string, number> | null): string | null {
  if (!counts) return null;
  let leading: string | null = null;
  let best = 0;
  for (const [domain, count] of Object.entries(counts)) {
    if (count > best) {
      leading = domain;
      best = count;
    }
  }
  return leading;
}

function carriesOptionalCategory(properties: ReportProperties): boolean {
  return Object.keys(properties).some((key) => OPTIONAL_KEYS.has(key));
}

export class SelfHostedInstanceService {
  constructor(
    private readonly deps: {
      repository: SelfHostedInstanceRepository;
      owners: InstanceOwnerLookup;
      organizations: OrganizationNameLookup;
      /** Absent where nothing is listening, such as a self-hosted receiver. */
      crm?: SelfHostedCrm | null;
      now?: () => Date;
    },
  ) {}

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  /**
   * Writes one report down: the install's row, the report itself, and whatever
   * the report says that somebody should hear about.
   *
   * Returns the signals it raised, which is what a test asserts on and what a
   * caller can log. The caller decides what a failure here means. It is called
   * from a public route, where refusing the report would take the install with
   * it, so the route swallows the failure and answers as though the report had
   * landed.
   */
  async recordReport({
    instanceId,
    properties,
    unknownFields,
    receivedAt,
  }: IncomingReport): Promise<SelfHostedSignal[]> {
    const [previous, owner] = await Promise.all([
      this.deps.repository.findByInstanceId(instanceId),
      this.deps.owners.findByInstanceId(instanceId),
    ]);

    const reportedDomains = domains(properties.user_email_domains);
    const leadingDomain = largestDomain(reportedDomains);
    const alreadyRaised = previous?.raisedSignals ?? [];

    // With nothing listening there is nothing to raise, and a signal recorded
    // as raised without being announced would be lost rather than delayed.
    const signals = this.deps.crm
      ? signalsRaisedBy({
          properties,
          firstSeenAt: previous?.firstSeenAt ?? null,
          alreadyRaised,
          license: owner ? { expiresAt: owner.expiresAt } : null,
          domainHasCloudAccount: await this.cloudAccountOnDomain({
            leadingDomain,
            alreadyRaised,
          }),
          now: receivedAt,
        })
      : [];

    await this.deps.repository.upsert({
      instanceId,
      lastSeenAt: receivedAt,
      version: text(properties.version),
      installMethod: text(properties.install_method),
      chartVersion: text(properties.chart_version),
      hostname: text(properties.hostname),
      environment: text(properties.environment),
      installedAt: day(properties.first_seen_at),
      reportSchemaVersion: whole(properties.report_schema_version),
      organizationId: owner?.organizationId ?? null,
      issuedLicenseId: owner?.issuedLicenseId ?? null,
      userEmailDomains: reportedDomains,
      latestReport: properties,
      optionalMetricsReported: carriesOptionalCategory(properties),
      hostnameReported: text(properties.hostname) !== null,
      lastUnknownFields: unknownFields,
      raisedSignals: [...alreadyRaised, ...signals],
    });

    await this.deps.repository.appendReport({
      instanceId,
      receivedAt,
      version: text(properties.version),
      reportSchemaVersion: whole(properties.report_schema_version),
      unknownFields,
      payload: properties,
    });

    if (signals.length > 0 && this.deps.crm) {
      const stored = await this.deps.repository.findByInstanceId(instanceId);
      if (stored) {
        await this.deps.crm.announce({
          signals,
          instance: stored,
          leadingDomain,
          organizationId: owner?.organizationId ?? null,
        });
      }
    }

    return signals;
  }

  /**
   * Whether the company running this install already has a Cloud account.
   *
   * Asked only while the answer can still change anything: once the signal has
   * been raised it is never raised again, so a daily report would otherwise pay
   * for a lookup whose answer is already on the row.
   */
  private async cloudAccountOnDomain({
    leadingDomain,
    alreadyRaised,
  }: {
    leadingDomain: string | null;
    alreadyRaised: readonly string[];
  }): Promise<boolean> {
    if (!leadingDomain || !this.deps.crm) return false;
    if (alreadyRaised.includes("domain_has_cloud_account")) return false;
    return this.deps.crm.hasAccountOnDomain(leadingDomain);
  }

  /** Installs by most recent activity, which is the order an operator wants. */
  async getAll(input: {
    page: number;
    pageSize: number;
    search?: string;
  }): Promise<{ instances: SelfHostedInstanceView[]; total: number }> {
    const { rows, total } = await this.deps.repository.findAll(input);
    return { instances: await this.viewsOf(rows), total };
  }

  async getById(input: { id: string }): Promise<{
    instance: SelfHostedInstanceView;
    reports: {
      id: string;
      receivedAt: Date;
      version: string | null;
      unknownFields: number;
    }[];
  } | null> {
    const row = await this.deps.repository.findById(input.id);
    if (!row) return null;
    const [instance] = await this.viewsOf([row]);
    if (!instance) return null;
    const reports = await this.deps.repository.findReports({
      instanceId: row.instanceId,
      limit: REPORT_HISTORY_LIMIT,
    });
    return { instance, reports };
  }

  private async viewsOf(
    rows: SelfHostedInstanceRecord[],
  ): Promise<SelfHostedInstanceView[]> {
    const now = this.now();
    const organizationIds = [
      ...new Set(
        rows
          .map((row) => row.organizationId)
          .filter((id): id is string => id !== null),
      ),
    ];
    const names =
      organizationIds.length > 0
        ? await this.deps.organizations.findNames(organizationIds)
        : {};

    return rows.map((row) => ({
      ...row,
      organizationName: row.organizationId
        ? (names[row.organizationId] ?? null)
        : null,
      activity: instanceActivity({ lastSeenAt: row.lastSeenAt, now }),
    }));
  }
}
