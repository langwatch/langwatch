/**
 * What an organization's usage against its plan looks like, as every door
 * reads it.
 *
 * The vocabulary was in `platform/app`, so `LimitsTrpcPorts.getUsageStats`
 * could only say `Promise<unknown>` — and `unknown` is what a tRPC procedure
 * publishes, so the sidebar's usage bar, the usage settings page and the
 * dashboard body were all reading fields off `{}`. The port's own note said
 * the concrete shape reached the client through the generic; it did not.
 */
import type { PlanInfo } from "./plan";

/** Where usage stands against the allowance. */
export type MessageLimitStatus = "ok" | "warning" | "exceeded";

/** What the allowance is measured in. */
export type UsageUnit = "traces" | "events";

/**
 * The limit reading, with its copy already written.
 *
 * Pre-formatted here rather than in the browser because the same sentence
 * appears in the sidebar, on the settings page and in the approaching-limit
 * email, and three renderings of one number is how they start disagreeing.
 */
export interface MessageLimitInfo {
  status: MessageLimitStatus;
  current: number;
  max: number;
  currentFormatted: string;
  maxFormatted: string;
  percentageFormatted: string;
  message: string;
}

/** One organization's usage for the current period, and the plan it is measured against. */
export interface UsageStats {
  /** Null on a legacy or unlimited response, which has no count to show. */
  currentMonthMessagesCount: number | null;
  currentMonthCost: number;
  activePlan: PlanInfo;
  maxMonthlyUsageLimit: number;
  membersCount: number;
  membersLiteCount: number;
  messageLimitInfo: MessageLimitInfo;
  usageUnit: UsageUnit;
}
