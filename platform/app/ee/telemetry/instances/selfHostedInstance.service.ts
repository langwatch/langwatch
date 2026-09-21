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

function carriesOptionalCategory(properties: ReportProperties): boolean {
  return Object.keys(properties).some((key) => OPTIONAL_KEYS.has(key));
}

export class SelfHostedInstanceService {
  constructor(
    private readonly deps: {
      repository: SelfHostedInstanceRepository;
      owners: InstanceOwnerLookup;
      organizations: OrganizationNameLookup;
      now?: () => Date;
    },
  ) {}

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  /**
   * Writes one report down: the install's row, and the report itself.
   *
   * The caller decides what a failure here means. It is called from a public
   * route, where refusing the report would take the install with it, so the
   * route swallows the failure and answers as though the report had landed.
   */
  async recordReport({
    instanceId,
    properties,
    unknownFields,
    receivedAt,
  }: IncomingReport): Promise<void> {
    const owner = await this.deps.owners.findByInstanceId(instanceId);

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
      userEmailDomains: domains(properties.user_email_domains),
      latestReport: properties,
      optionalMetricsReported: carriesOptionalCategory(properties),
      hostnameReported: text(properties.hostname) !== null,
      lastUnknownFields: unknownFields,
    });

    await this.deps.repository.appendReport({
      instanceId,
      receivedAt,
      version: text(properties.version),
      reportSchemaVersion: whole(properties.report_schema_version),
      unknownFields,
      payload: properties,
    });
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
