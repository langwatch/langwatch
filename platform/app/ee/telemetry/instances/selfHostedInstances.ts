/**
 * The registry of self-hosted installs: what a report says, what a stored row
 * holds, and what the store has to offer (ADR-139, section 10).
 *
 * @see specs/self-hosting/connected-services/instance-registry.feature
 */

/** Every field the usage report receiver accepted, minus the instance id. */
export type ReportProperties = Record<string, unknown>;

/** One report, as the receiver hands it over. */
export interface IncomingReport {
  instanceId: string;
  properties: ReportProperties;
  unknownFields: number;
  receivedAt: Date;
}

/** The customer an install belongs to, resolved from its license. */
export interface InstanceOwner {
  organizationId: string | null;
  issuedLicenseId: string | null;
  /** When the term ends, which is what the expiring signal reads. */
  expiresAt: Date | null;
}

/** What one report writes onto an install's row. */
export interface InstanceRowUpsert {
  instanceId: string;
  lastSeenAt: Date;
  version: string | null;
  installMethod: string | null;
  chartVersion: string | null;
  hostname: string | null;
  environment: string | null;
  installedAt: Date | null;
  reportSchemaVersion: number | null;
  organizationId: string | null;
  issuedLicenseId: string | null;
  userEmailDomains: Record<string, number> | null;
  latestReport: ReportProperties;
  optionalMetricsReported: boolean;
  hostnameReported: boolean;
  lastUnknownFields: number;
  /** Every signal raised for this install so far, including the new ones. */
  raisedSignals: string[];
}

/** One report row of the history. */
export interface InstanceReportInsert {
  instanceId: string;
  receivedAt: Date;
  version: string | null;
  reportSchemaVersion: number | null;
  unknownFields: number;
  payload: ReportProperties;
}

/** An install's row as it leaves the store. */
export interface SelfHostedInstanceRecord {
  id: string;
  instanceId: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
  version: string | null;
  installMethod: string | null;
  chartVersion: string | null;
  hostname: string | null;
  environment: string | null;
  installedAt: Date | null;
  reportSchemaVersion: number | null;
  organizationId: string | null;
  issuedLicenseId: string | null;
  userEmailDomains: Record<string, number> | null;
  latestReport: ReportProperties | null;
  optionalMetricsReported: boolean;
  hostnameReported: boolean;
  reportCount: number;
  lastUnknownFields: number;
  raisedSignals: string[];
}

/** What the backoffice adds to a row before it reaches the screen. */
export interface SelfHostedInstanceView extends SelfHostedInstanceRecord {
  /** The customer's name, when the license bound this install to one. */
  organizationName: string | null;
  /** How the install is doing right now, read from when it last reported. */
  activity: InstanceActivity;
}

/**
 * Whether an install is still running.
 *
 * A report is daily, so two days of silence is already a gap rather than a
 * late report, and a fortnight is an install that has been turned off. The
 * point of the three is that a list of installs sorted by last activity says
 * which are worth talking to without an operator doing date arithmetic.
 */
export type InstanceActivity = "reporting" | "quiet" | "gone";

const DAY_MS = 24 * 60 * 60 * 1000;

export function instanceActivity({
  lastSeenAt,
  now,
}: {
  lastSeenAt: Date;
  now: Date;
}): InstanceActivity {
  const age = now.getTime() - lastSeenAt.getTime();
  if (age <= 2 * DAY_MS) return "reporting";
  if (age <= 14 * DAY_MS) return "quiet";
  return "gone";
}

/** How the registry reaches storage. */
export interface SelfHostedInstanceRepository {
  /** Creates the row on a first report, updates it on every one after. */
  upsert(row: InstanceRowUpsert): Promise<void>;
  /** Appends the report to the history. */
  appendReport(report: InstanceReportInsert): Promise<void>;
  findAll(input: {
    page: number;
    pageSize: number;
    search?: string;
  }): Promise<{ rows: SelfHostedInstanceRecord[]; total: number }>;
  findById(id: string): Promise<SelfHostedInstanceRecord | null>;
  /** The row as it stood before this report, or null on a first report. */
  findByInstanceId(
    instanceId: string,
  ): Promise<SelfHostedInstanceRecord | null>;
  /** The history of one install, newest first. */
  findReports(input: { instanceId: string; limit: number }): Promise<
    {
      id: string;
      receivedAt: Date;
      version: string | null;
      unknownFields: number;
    }[]
  >;
}

/** Where the customer behind an install comes from. */
export interface InstanceOwnerLookup {
  /**
   * The license bound to this instance, if any. Bound means the install
   * presented its token to license sync, which is the only credential a
   * self-hosted install ever holds.
   */
  findByInstanceId(instanceId: string): Promise<InstanceOwner | null>;
}

/** Customer names, for the list screen. */
export interface OrganizationNameLookup {
  findNames(
    organizationIds: string[],
  ): Promise<Record<string, string | undefined>>;
}
