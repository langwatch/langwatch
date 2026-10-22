// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { CioOrgTraits, NurturingSignalOf } from "@langwatch/enterprise-nurturing-contract";
import { Temporal } from "@langwatch/time";

/**
 * Customer.io's timestamp conditions in segments and campaign branches only match
 * Unix seconds, so every date attribute sent there goes out as whole seconds.
 */
export function unixSecondsOf(epochMilliseconds: number): number {
  return Math.floor(epochMilliseconds / 1000);
}

/** An ISO-8601 instant, as an owner recorded it, in Customer.io's Unix seconds. */
export function unixSecondsOfIso(iso: string): number {
  return unixSecondsOf(Temporal.Instant.from(iso).epochMilliseconds);
}

/** A self-hosted report's traits for Customer.io: its two ISO dates as Unix seconds, each only when reported. */
export function selfHostedTraits(
  traits: NurturingSignalOf<"self_hosted_crm">["traits"],
): Partial<CioOrgTraits> {
  const {
    self_hosted_first_seen_at: firstSeenAt,
    self_hosted_last_report_at: lastReportAt,
    ...rest
  } = traits;
  return {
    ...rest,
    ...(firstSeenAt ? { self_hosted_first_seen_at: unixSecondsOfIso(firstSeenAt) } : {}),
    ...(lastReportAt ? { self_hosted_last_report_at: unixSecondsOfIso(lastReportAt) } : {}),
  };
}
