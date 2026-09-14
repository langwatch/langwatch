import { HandledError } from "@langwatch/handled-error";

/**
 * Plan monthly event allowance exceeded. Uses 402 (not 429) to prevent retries,
 * as the failure is terminal. Code stays ERR_PLAN_LIMIT for SDK compatibility.
 */
export class PlanLimitExceededError extends HandledError {
  declare readonly code: "ERR_PLAN_LIMIT";

  constructor(
    message: string,
    meta: {
      currentMonthMessagesCount?: number;
      maxMessagesPerMonth?: number;
      activePlanName?: string;
    } = {},
  ) {
    super("ERR_PLAN_LIMIT", message, {
      meta,
      httpStatus: 402,
      fault: "customer",
      tips: ["Upgrade the plan to raise the monthly event allowance."],
    });
    this.name = "PlanLimitExceededError";
  }
}
