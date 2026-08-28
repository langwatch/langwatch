// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { deriveSourceHealth } from "@ee/governance/services/pullers/sourceHealth";
import { CircleAlert, CircleCheck, CircleDashed, CircleX } from "lucide-react";

/**
 * What the source badge says, on the inventory list and the detail header.
 *
 * Two different questions share one badge. Status is what an admin
 * configured: active, disabled, waiting for its first event. Health is
 * whether the puller still works, derived at read time from the consecutive
 * failure count (ADR-128) -- never stored as a fourth status, because a
 * provider outage must not be able to rewrite configuration.
 *
 * Health wins when the two disagree. A source configured "active" whose last
 * three runs all failed is not active in the sense any reader means, and
 * showing the green check there is how a broken integration goes unnoticed
 * for a week.
 */
export interface SourceBadge {
  icon: typeof CircleCheck;
  label: string;
  color: string;
}

export const SOURCE_STATUS_META: Record<string, SourceBadge> = {
  active: { icon: CircleCheck, label: "Active", color: "green.500" },
  awaiting_first_event: {
    icon: CircleDashed,
    label: "Awaiting first event",
    color: "amber.500",
  },
  disabled: { icon: CircleX, label: "Disabled", color: "fg.muted" },
};

export const SOURCE_UNHEALTHY_META: SourceBadge = {
  icon: CircleAlert,
  label: "Not pulling",
  color: "red.500",
};

export function sourceBadge({
  status,
  errorCount,
}: {
  status: string;
  errorCount: number;
}): SourceBadge {
  if (deriveSourceHealth({ consecutiveFailures: errorCount }) === "unhealthy") {
    return SOURCE_UNHEALTHY_META;
  }
  return SOURCE_STATUS_META[status] ?? SOURCE_STATUS_META.awaiting_first_event!;
}

/**
 * The line under a broken source: how far back the numbers can be trusted.
 *
 * Returns null while the source is healthy, and null when it has never
 * pulled successfully -- there is no "since" to name in either case, and the
 * awaiting-first-event badge already covers the second.
 */
export function noDataSinceNotice({
  errorCount,
  lastSuccessAt,
}: {
  errorCount: number;
  lastSuccessAt: Date | string | null;
}): { lastSuccessIso: string } | null {
  if (deriveSourceHealth({ consecutiveFailures: errorCount }) === "healthy") {
    return null;
  }
  if (lastSuccessAt === null) return null;
  const iso =
    typeof lastSuccessAt === "string"
      ? lastSuccessAt
      : lastSuccessAt.toISOString();
  return { lastSuccessIso: iso };
}
