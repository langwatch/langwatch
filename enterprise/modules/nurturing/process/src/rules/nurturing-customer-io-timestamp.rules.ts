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

/** An ISO-8601 instant in Customer.io's Unix seconds; throws a RangeError when it is not a valid instant. */
function getUnixSecondsOfIso(iso: string): number {
  return unixSecondsOf(Temporal.Instant.from(iso).epochMilliseconds);
}

/** The date as a one-key trait, or nothing when it is absent or malformed, so one bad date never drops the rest. */
function dateTrait<Key extends string>(key: Key, iso: string | undefined): { [K in Key]?: number } {
  if (!iso) return {};
  try {
    return { [key]: getUnixSecondsOfIso(iso) } as { [K in Key]?: number };
  } catch (error) {
    if (error instanceof RangeError) return {};
    throw error;
  }
}

/** A self-hosted report's traits for Customer.io: its two ISO dates as Unix seconds, each only when reported and valid. */
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
    ...dateTrait("self_hosted_first_seen_at", firstSeenAt),
    ...dateTrait("self_hosted_last_report_at", lastReportAt),
  };
}
