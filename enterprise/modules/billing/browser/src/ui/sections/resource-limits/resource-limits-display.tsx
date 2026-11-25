import { StatTileGrid } from "@langwatch/design-system/stat-tile";
import { LIMIT_TYPE_DISPLAY_LABELS } from "@langwatch/enterprise-licensing-contract";
import type { UsageStats } from "@langwatch/entitlement-contract";
import type { ReactNode } from "react";

import { ResourceLimitRow } from "../../../behavior/lent-resource-limit-row.tsx";

/** Resource keys that can be displayed in the limits component */
export type ResourceKey =
  | "members"
  | "membersLite"
  | "messagesPerMonth"
  | "eventsPerMonth"
  | "tracesPerMonth";
/**
 * Display labels for each resource type.
 * Uses LIMIT_TYPE_DISPLAY_LABELS for core limit types, with additional
 * resource-specific labels that are used only in the usage display.
 */
export const RESOURCE_LABELS: Record<ResourceKey, string> = {
  ...LIMIT_TYPE_DISPLAY_LABELS,
  members: "Team members",
  membersLite: "Lite members",
  // Default label is "Events / month"; for TIERED orgs this is overridden
  // via the `messagesLabel` prop so they can display a different label
  // (e.g. "Traces / month"). See ResourceLimitsDisplay component.
  messagesPerMonth: "Events / month",
  // Label-only keys: not part of the ResourceLimits interface but included
  // here so that dynamic label resolution in usage.tsx (around line 109) can
  // look up a human-readable name for these resource types at runtime.
  eventsPerMonth: "Events / month",
  tracesPerMonth: "Traces / month",
} as const;

/** Ordered list of resource keys for consistent rendering */
const RESOURCE_ORDER: (keyof ResourceLimits)[] = [
  "members",
  "membersLite",
  "messagesPerMonth",
] as const;

/** Each resource's current use; the self-hosted page reads use, not limits. */
export interface ResourceLimits {
  members: { current: number };
  membersLite: { current: number };
  messagesPerMonth: { current: number };
}

/** Input type for license status data with resource counts */
interface LicenseStatusCounts {
  currentMembers: number;
  currentMembersLite: number;
  currentMessagesPerMonth: number;
}

/** Input type for usage data from the limits.getUsage query */
type UsageData = Pick<
  UsageStats,
  "membersCount" | "membersLiteCount" | "currentMonthMessagesCount"
>;

/** Maps a valid license's counts to ResourceLimits. */
export function mapLicenseStatusToLimits(licenseData: LicenseStatusCounts): ResourceLimits {
  return {
    members: { current: licenseData.currentMembers },
    membersLite: { current: licenseData.currentMembersLite },
    messagesPerMonth: { current: licenseData.currentMessagesPerMonth },
  };
}

/** Maps an unlicensed installation's usage counts to ResourceLimits. */
export function mapUsageToLimits(usage: UsageData): ResourceLimits {
  return {
    members: { current: usage.membersCount },
    membersLite: { current: usage.membersLiteCount },
    messagesPerMonth: { current: usage.currentMonthMessagesCount ?? 0 },
  };
}

export interface ResourceLimitsDisplayProps {
  limits: ResourceLimits;
  /** Override label for the messagesPerMonth resource (e.g. "Traces / month" for TIERED plans). */
  messagesLabel?: string;
  /** When true, show the Lite Members row. Only applies to SEAT_EVENT pricing model. */
  showLiteMembers?: boolean;
  /** A tile that leads the row, such as the plan the limits belong to. */
  leading?: ReactNode;
}

/**
 * Displays resource limits in a consistent format.
 * Used by both licensed plan and free tier sections on the usage page.
 */
export function ResourceLimitsDisplay({
  limits,
  messagesLabel,
  showLiteMembers = false,
  leading,
}: ResourceLimitsDisplayProps) {
  const visibleKeys = showLiteMembers
    ? RESOURCE_ORDER
    : RESOURCE_ORDER.filter((key) => key !== "membersLite");

  return (
    <StatTileGrid columns={visibleKeys.length + (leading ? 1 : 0)}>
      {leading}
      {visibleKeys.map((key) => {
        const label =
          key === "messagesPerMonth" && messagesLabel ? messagesLabel : RESOURCE_LABELS[key];
        return <ResourceLimitRow key={key} label={label} current={limits[key].current} />;
      })}
    </StatTileGrid>
  );
}
