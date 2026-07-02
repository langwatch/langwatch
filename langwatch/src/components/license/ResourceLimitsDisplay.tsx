import { SimpleGrid } from "@chakra-ui/react";
import { ResourceLimitRow } from "./ResourceLimitRow";
import type { PlanInfo } from "../../../ee/licensing/planInfo";
import { LIMIT_TYPE_DISPLAY_LABELS } from "~/server/license-enforcement/constants";

/** Resource keys that can be displayed in the limits component */
export type ResourceKey =
  | "members"
  | "membersLite"
  | "messagesPerMonth"
  | "eventsPerMonth"
  | "tracesPerMonth"
/**
 * Display labels for each resource type.
 * Uses LIMIT_TYPE_DISPLAY_LABELS for core limit types, with additional
 * resource-specific labels that are used only in the usage display.
 */
export const RESOURCE_LABELS: Record<ResourceKey, string> = {
  ...LIMIT_TYPE_DISPLAY_LABELS,
  membersLite: "Lite Members",
  // Default label is "Events / Month"; for TIERED orgs this is overridden
  // via the `messagesLabel` prop so they can display a different label
  // (e.g. "Traces / Month"). See ResourceLimitsDisplay component.
  messagesPerMonth: "Events / Month",
  // Label-only keys: not part of the ResourceLimits interface but included
  // here so that dynamic label resolution in usage.tsx (around line 109) can
  // look up a human-readable name for these resource types at runtime.
  eventsPerMonth: "Events / Month",
  tracesPerMonth: "Traces / Month",
} as const;

/** Ordered list of resource keys for consistent rendering */
const RESOURCE_ORDER: (keyof ResourceLimits)[] = [
  "members",
  "membersLite",
  "messagesPerMonth",
] as const;

export interface ResourceLimits {
  members: { current: number; max: number };
  membersLite: { current: number; max: number };
  messagesPerMonth: { current: number; max: number };
}

/** Input type for license status data with plan and resource counts */
interface LicenseStatusWithPlan {
  currentMembers: number;
  maxMembers: number;
  currentMembersLite: number;
  maxMembersLite: number;
  currentMessagesPerMonth: number;
  maxMessagesPerMonth: number;
}

/** Input type for usage data from the limits.getUsage query */
interface UsageData {
  membersCount: number;
  membersLiteCount: number;
  currentMonthMessagesCount: number | null;
}

/**
 * Maps license status data to ResourceLimits format.
 * Used when displaying limits for organizations with a valid license.
 */
export function mapLicenseStatusToLimits(
  licenseData: LicenseStatusWithPlan
): ResourceLimits {
  return {
    members: { current: licenseData.currentMembers, max: licenseData.maxMembers },
    membersLite: { current: licenseData.currentMembersLite, max: licenseData.maxMembersLite },
    messagesPerMonth: { current: licenseData.currentMessagesPerMonth, max: licenseData.maxMessagesPerMonth },
  };
}

/**
 * Maps usage data to ResourceLimits format using a plan's limits.
 * Used when displaying limits for organizations without a license (free tier).
 */
export function mapUsageToLimits(
  usage: UsageData,
  plan: PlanInfo
): ResourceLimits {
  return {
    members: { current: usage.membersCount, max: plan.maxMembers },
    membersLite: { current: usage.membersLiteCount, max: plan.maxMembersLite },
    messagesPerMonth: { current: usage.currentMonthMessagesCount ?? 0, max: plan.maxMessagesPerMonth },
  };
}

export interface ResourceLimitsDisplayProps {
  limits: ResourceLimits;
  /** When true, show "current / max" for member resources. Typically only for free plans. */
  showLimits?: boolean;
  /** Override label for the messagesPerMonth resource (e.g. "Traces / Month" for TIERED plans). */
  messagesLabel?: string;
  /** When true, show the Lite Members row. Only applies to SEAT_EVENT pricing model. */
  showLiteMembers?: boolean;
}

/**
 * Displays resource limits in a consistent format.
 * Used by both licensed plan and free tier sections on the usage page.
 */
export function ResourceLimitsDisplay({ limits, showLimits = false, messagesLabel, showLiteMembers = false }: ResourceLimitsDisplayProps) {
  const visibleKeys = showLiteMembers
    ? RESOURCE_ORDER
    : RESOURCE_ORDER.filter((key) => key !== "membersLite");

  return (
    <SimpleGrid columns={{ base: 1, md: 3 }} gap={3} width="full">
      {visibleKeys.map((key) => {
        const hideMax = !showLimits;
        const label = key === "messagesPerMonth" && messagesLabel ? messagesLabel : RESOURCE_LABELS[key];
        return (
          <ResourceLimitRow
            key={key}
            label={label}
            current={limits[key].current}
            max={hideMax ? undefined : limits[key].max}
          />
        );
      })}
    </SimpleGrid>
  );
}
