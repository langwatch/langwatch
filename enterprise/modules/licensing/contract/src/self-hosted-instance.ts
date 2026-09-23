// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The registry of self-hosted installs as it leaves the feature (ADR-156,
 * section 10). Every instant is an ISO string.
 *
 * @see specs/self-hosting/connected-services/instance-registry.feature
 */

/** Every field the usage report receiver accepted, minus the instance id. */
export type SelfHostedReportProperties = Record<string, unknown>;

/** Reporting within two days, silent under a fortnight, or turned off. */
export type SelfHostedInstanceActivity = "reporting" | "quiet" | "gone";

/** The handful of things an install can do that a person should hear about. */
export const SELF_HOSTED_SIGNALS = [
  "seats_crossed_threshold",
  "sustained_ingestion",
  "licensed_feature_without_license",
  "license_expiring",
  "domain_has_cloud_account",
  "license_sync_stale",
] as const;

export type SelfHostedSignal = (typeof SELF_HOSTED_SIGNALS)[number];

/** One install as the backoffice reads it. */
export interface SelfHostedInstanceView {
  id: string;
  instanceId: string;
  firstSeenAt: string;
  lastSeenAt: string;
  version: string | null;
  installMethod: string | null;
  chartVersion: string | null;
  hostname: string | null;
  environment: string | null;
  installedAt: string | null;
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
  /** The customer's name, when the license bound this install to one. */
  organizationName: string | null;
  activity: SelfHostedInstanceActivity;
}

export interface SelfHostedInstancePage {
  instances: SelfHostedInstanceView[];
  total: number;
}

/** One row of an install's report history. */
export interface SelfHostedReportSummary {
  id: string;
  receivedAt: string;
  version: string | null;
  unknownFields: number;
}

export interface SelfHostedInstanceDetail {
  instance: SelfHostedInstanceView;
  reports: SelfHostedReportSummary[];
}

/** One report, as the receiver hands it over. */
export interface IncomingUsageReport {
  instanceId: string;
  properties: SelfHostedReportProperties;
  unknownFields: number;
  /** ISO instant the receiver accepted it. */
  receivedAt: string;
}
