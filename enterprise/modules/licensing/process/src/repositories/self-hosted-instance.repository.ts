/**
 * The registry of self-hosted installs (ADR-156, section 10): one row per
 * install, and the history of what it reported.
 */

import type {
  SelfHostedInstanceSort,
  SelfHostedReportProperties,
} from "@langwatch/enterprise-licensing-contract";
import type { Instant } from "@langwatch/time";

/** What one report writes onto an install's row. */
export type SelfHostedInstanceUpsert = Readonly<{
  instanceId: string;
  lastSeenAt: Instant;
  version: string | null;
  installMethod: string | null;
  chartVersion: string | null;
  hostname: string | null;
  environment: string | null;
  installedAt: Instant | null;
  reportSchemaVersion: number | null;
  organizationId: string | null;
  issuedLicenseId: string | null;
  userEmailDomains: Record<string, number> | null;
  latestReport: SelfHostedReportProperties;
  optionalMetricsReported: boolean;
  hostnameReported: boolean;
  lastUnknownFields: number;
  /** Every signal raised for this install so far, including the new ones. */
  raisedSignals: readonly string[];
}>;

export type SelfHostedReportInsert = Readonly<{
  instanceId: string;
  receivedAt: Instant;
  version: string | null;
  reportSchemaVersion: number | null;
  unknownFields: number;
  payload: SelfHostedReportProperties;
}>;

/** An install's row, as stored. */
export interface SelfHostedInstanceRecord {
  id: string;
  instanceId: string;
  firstSeenAt: Instant;
  lastSeenAt: Instant;
  version: string | null;
  installMethod: string | null;
  chartVersion: string | null;
  hostname: string | null;
  environment: string | null;
  installedAt: Instant | null;
  reportSchemaVersion: number | null;
  organizationId: string | null;
  issuedLicenseId: string | null;
  userEmailDomains: Record<string, number> | null;
  latestReport: SelfHostedReportProperties | null;
  optionalMetricsReported: boolean;
  hostnameReported: boolean;
  reportCount: number;
  lastUnknownFields: number;
  raisedSignals: string[];
}

export interface SelfHostedReportRecord {
  id: string;
  receivedAt: Instant;
  version: string | null;
  unknownFields: number;
}

/** One page of the list: the order, and the filters already turned into columns. */
export type SelfHostedInstanceQuery = Readonly<{
  page: number;
  pageSize: number;
  search?: string;
  sort: SelfHostedInstanceSort;
  licensed?: boolean;
  /** Last report at or after this instant. */
  seenSince?: Instant;
  /** Last report strictly before this instant. */
  seenBefore?: Instant;
  signal?: string;
}>;

/** The registry's counts; `reporting` and `quiet` split on the two instants passed. */
export type SelfHostedInstanceTally = Readonly<{
  total: number;
  reporting: number;
  quiet: number;
  licensed: number;
  /** `traces_28d` summed over the reporting installs. */
  traces28d: number;
  signals: { signal: string; count: number }[];
  /** Over the reporting and quiet installs, most common first. */
  releases: { version: string; count: number }[];
}>;

export interface SelfHostedInstanceRepository {
  /** Creates the row on a first report, updates it on every one after. */
  upsert(row: SelfHostedInstanceUpsert): Promise<void>;
  appendReport(report: SelfHostedReportInsert): Promise<void>;
  /** In the asked order; a usage order puts an install that reported no such number last. */
  listPage(input: SelfHostedInstanceQuery): Promise<{
    rows: SelfHostedInstanceRecord[];
    total: number;
  }>;
  tally(input: {
    reportingSince: Instant;
    quietSince: Instant;
    releaseLimit: number;
  }): Promise<SelfHostedInstanceTally>;
  /** When each install that first reported at or after `since` did so. */
  findFirstSeenSince(since: Instant): Promise<Instant[]>;
  /** Throws `SelfHostedInstanceNotFoundError` when no install has that row id. */
  getById(id: string): Promise<SelfHostedInstanceRecord>;
  /** The row an install already has; empty before its first report. */
  findByInstanceId(instanceId: string): Promise<SelfHostedInstanceRecord[]>;
  /** The history of one install, newest first. */
  findReports(input: { instanceId: string; limit: number }): Promise<SelfHostedReportRecord[]>;
}
