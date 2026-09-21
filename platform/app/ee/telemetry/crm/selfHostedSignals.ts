/**
 * The handful of things a self-hosted install can do that a person should hear
 * about (ADR-139, section 10).
 *
 * A daily report from every install is a firehose, and a sales team that gets
 * one message a day per install stops reading them. So this is deliberately
 * short, and every signal here answers "would somebody pick up the phone": a
 * deployment that grew past a team, one that has been ingesting for a month, one
 * running a licensed feature without a license, a licence about to lapse, and a
 * company that already has an account with us.
 *
 * Each signal fires once per install. The install's row records which have been
 * raised, and a signal already on that list is not raised again, so an install
 * that stays large does not report being large every morning.
 *
 * Pure: no IO, no clock of its own. That is what lets the thresholds be argued
 * about in a test rather than in production.
 *
 * @see specs/self-hosting/connected-services/self-hosted-lead-signals.feature
 */

import type { ReportProperties } from "../instances/selfHostedInstances";

export const SELF_HOSTED_SIGNALS = [
  "seats_crossed_threshold",
  "sustained_ingestion",
  "licensed_feature_without_license",
  "license_expiring",
  "domain_has_cloud_account",
] as const;

export type SelfHostedSignal = (typeof SELF_HOSTED_SIGNALS)[number];

/** What each signal says, in the sentence a person reads in Slack. */
export const SIGNAL_HEADLINES: Record<SelfHostedSignal, string> = {
  seats_crossed_threshold: "A self-hosted install grew past a team",
  sustained_ingestion: "A self-hosted install has been ingesting for a month",
  licensed_feature_without_license:
    "A self-hosted install runs a licensed feature with no license",
  license_expiring: "A self-hosted license is about to lapse",
  domain_has_cloud_account:
    "A self-hosted install is run by a company we already know",
};

/**
 * The numbers the signals turn on.
 *
 * Held together and named, because these are the argument: what counts as more
 * than a team, what counts as real ingestion, and how long before a term ends
 * somebody should be talking to the customer.
 */
export const SIGNAL_THRESHOLDS = {
  /** Above a handful of people, a deployment is a team rather than a trial. */
  seats: 25,
  /** A month of this is a workload, not an evaluation. */
  traces28d: 10_000,
  /** Reporting for this long makes a 28 day window mean what it says. */
  establishedDays: 28,
  /** Long enough before a term ends to renew it without a scramble. */
  licenseExpiringDays: 45,
} as const;

const DAY_MS = 24 * 60 * 60 * 1000;

/** What the rules are allowed to look at. */
export interface SignalInput {
  /** The report that has just arrived. */
  properties: ReportProperties;
  /** When the install was first heard from, or null on a first report. */
  firstSeenAt: Date | null;
  /** Signals already raised for this install. */
  alreadyRaised: readonly string[];
  /** The license bound to this instance, when there is one. */
  license: { expiresAt: Date | null } | null;
  /**
   * Whether one of the reported domains already has an account on LangWatch
   * Cloud. Resolved by the caller, because it is a query rather than a rule.
   */
  domainHasCloudAccount: boolean;
  now: Date;
}

function whole(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** An install that has been reporting long enough for a 28 day window to mean it. */
function established({
  firstSeenAt,
  now,
}: {
  firstSeenAt: Date | null;
  now: Date;
}): boolean {
  if (!firstSeenAt) return false;
  const days = (now.getTime() - firstSeenAt.getTime()) / DAY_MS;
  return days >= SIGNAL_THRESHOLDS.establishedDays;
}

/**
 * Single sign-on is the licensed feature an install can run without asking us,
 * because the code ships in the image. An install with it configured and no
 * license is a customer, not a prospect.
 */
function runsLicensedFeature(properties: ReportProperties): boolean {
  return text(properties.sso_provider) !== null;
}

/** Which signals this report raises that have not been raised before. */
export function signalsRaisedBy(input: SignalInput): SelfHostedSignal[] {
  const already = new Set(input.alreadyRaised);
  const raised: SelfHostedSignal[] = [];
  const raise = (signal: SelfHostedSignal, when: boolean) => {
    if (when && !already.has(signal)) raised.push(signal);
  };

  const users = whole(input.properties.users) ?? 0;
  raise("seats_crossed_threshold", users >= SIGNAL_THRESHOLDS.seats);

  const traces = whole(input.properties.traces_28d) ?? 0;
  raise(
    "sustained_ingestion",
    traces >= SIGNAL_THRESHOLDS.traces28d &&
      established({ firstSeenAt: input.firstSeenAt, now: input.now }),
  );

  raise(
    "licensed_feature_without_license",
    input.license === null && runsLicensedFeature(input.properties),
  );

  const expiresAt = input.license?.expiresAt ?? null;
  const daysLeft = expiresAt
    ? (expiresAt.getTime() - input.now.getTime()) / DAY_MS
    : null;
  raise(
    "license_expiring",
    daysLeft !== null &&
      daysLeft >= 0 &&
      daysLeft <= SIGNAL_THRESHOLDS.licenseExpiringDays,
  );

  raise("domain_has_cloud_account", input.domainHasCloudAccount);

  return raised;
}
