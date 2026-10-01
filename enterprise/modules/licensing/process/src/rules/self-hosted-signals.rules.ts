/**
 * What a self-hosted install can do that a person should hear about, each
 * raised once per install (ADR-156, section 10). Pure, so the thresholds are
 * argued about in a test rather than in production.
 * @see specs/self-hosting/connected-services/self-hosted-lead-signals.feature
 */

import type {
  SelfHostedReportProperties,
  SelfHostedSignal,
} from "@langwatch/enterprise-licensing-contract";
import type { Instant } from "@langwatch/time";

import { isReportNumber, isReportText } from "./self-hosted-report.rules.ts";

/** What each signal says, in the sentence a person reads in Slack. */
export const SIGNAL_HEADLINES: Record<SelfHostedSignal, string> = {
  seats_crossed_threshold: "A self-hosted install grew past a team",
  sustained_ingestion: "A self-hosted install has been ingesting for a month",
  licensed_feature_without_license: "A self-hosted install runs a licensed feature with no license",
  license_expiring: "A self-hosted license is about to lapse",
  domain_has_cloud_account: "A self-hosted install is run by a company we already know",
  license_sync_stale: "A connected self-hosted install has not synced its license for a week",
};

/** The CRM event each signal is tracked as. */
export const SIGNAL_EVENTS = {
  seats_crossed_threshold: "self_hosted_seats_crossed_threshold",
  sustained_ingestion: "self_hosted_sustained_ingestion",
  licensed_feature_without_license: "self_hosted_licensed_feature_without_license",
  license_expiring: "self_hosted_license_expiring",
  domain_has_cloud_account: "self_hosted_domain_has_cloud_account",
  license_sync_stale: "self_hosted_license_sync_stale",
} as const satisfies Record<SelfHostedSignal, string>;

export type SelfHostedSignalEvent = (typeof SIGNAL_EVENTS)[SelfHostedSignal];

/** The numbers the signals turn on, held together because they are the argument. */
export const SIGNAL_THRESHOLDS = {
  /** Above a handful of people, a deployment is a team rather than a trial. */
  seats: 25,
  /** A month of this is a workload, not an evaluation. */
  traces28d: 10_000,
  /** Reporting for this long makes a 28 day window mean what it says. */
  establishedDays: 28,
  /** Long enough before a term ends to renew it without a scramble. */
  licenseExpiringDays: 45,
  /** The sync runs daily, so a week of silence is a stopped install. */
  licenseSyncStaleDays: 7,
} as const;

const DAY_MS = 24 * 60 * 60 * 1000;

export type SignalInput = Readonly<{
  properties: SelfHostedReportProperties;
  /** When the install was first heard from; absent on a first report. */
  firstSeenAt: Instant | undefined;
  alreadyRaised: readonly string[];
  /** The license bound to this instance; a license that never synced is not stale. */
  license:
    | Readonly<{ expiresAt: Instant | undefined; lastSyncAt: Instant | undefined }>
    | undefined;
  /** Resolved by the caller, because it is a query rather than a rule. */
  domainHasCloudAccount: boolean;
  now: Instant;
}>;

function countOf(value: unknown): number {
  return isReportNumber(value) ? value : 0;
}

function daysBetween({ from, to }: { from: Instant; to: Instant }): number {
  return (to.epochMilliseconds - from.epochMilliseconds) / DAY_MS;
}

/** Single sign-on ships in the image, so an install running it unlicensed is a customer. */
function runsLicensedFeature(properties: SelfHostedReportProperties): boolean {
  return isReportText(properties.sso_provider);
}

/** Which signals this report raises that have not been raised before. */
export function signalsRaisedBy(input: SignalInput): SelfHostedSignal[] {
  const already = new Set(input.alreadyRaised);
  const raised: SelfHostedSignal[] = [];
  const raise = (signal: SelfHostedSignal, when: boolean) => {
    if (when && !already.has(signal)) raised.push(signal);
  };

  raise("seats_crossed_threshold", countOf(input.properties.users) >= SIGNAL_THRESHOLDS.seats);

  const established =
    input.firstSeenAt !== undefined &&
    daysBetween({ from: input.firstSeenAt, to: input.now }) >= SIGNAL_THRESHOLDS.establishedDays;
  raise(
    "sustained_ingestion",
    countOf(input.properties.traces_28d) >= SIGNAL_THRESHOLDS.traces28d && established,
  );

  raise(
    "licensed_feature_without_license",
    input.license === undefined && runsLicensedFeature(input.properties),
  );

  const expiresAt = input.license?.expiresAt;
  const daysLeft =
    expiresAt === undefined ? undefined : daysBetween({ from: input.now, to: expiresAt });
  raise(
    "license_expiring",
    daysLeft !== undefined && daysLeft >= 0 && daysLeft <= SIGNAL_THRESHOLDS.licenseExpiringDays,
  );

  raise("domain_has_cloud_account", input.domainHasCloudAccount);

  const lastSyncAt = input.license?.lastSyncAt;
  raise(
    "license_sync_stale",
    lastSyncAt !== undefined &&
      daysBetween({ from: lastSyncAt, to: input.now }) >= SIGNAL_THRESHOLDS.licenseSyncStaleDays,
  );

  return raised;
}
