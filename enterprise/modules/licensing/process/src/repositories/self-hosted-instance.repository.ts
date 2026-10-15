/**
 * The registry of self-hosted installs (ADR-156, section 10): one row per
 * install, and the history of what it reported.
 */

import type { SelfHostedReportProperties } from "@langwatch/enterprise-licensing-contract";
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

export interface SelfHostedInstanceRepository {
  /** Creates the row on a first report, updates it on every one after. */
  upsert(row: SelfHostedInstanceUpsert): Promise<void>;
  appendReport(report: SelfHostedReportInsert): Promise<void>;
  /** Most recent activity first, which is the order an operator wants. */
  listPage(input: {
    page: number;
    pageSize: number;
    search?: string;
  }): Promise<{ rows: SelfHostedInstanceRecord[]; total: number }>;
  /** Throws `SelfHostedInstanceNotFoundError` when no install has that row id. */
  getById(id: string): Promise<SelfHostedInstanceRecord>;
  /** The row an install already has; empty before its first report. */
  findByInstanceId(instanceId: string): Promise<SelfHostedInstanceRecord[]>;
  /** The history of one install, newest first. */
  findReports(input: { instanceId: string; limit: number }): Promise<SelfHostedReportRecord[]>;
}
