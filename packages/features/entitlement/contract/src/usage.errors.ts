import { HandledError } from "@langwatch/handled-error";

/**
 * The project has spent its plan's monthly event allowance.
 *
 * 402 rather than 429 on purpose. The OTel SDKs, and most HTTP clients with a
 * retry policy, treat 429 as transient and re-post the same batch until their
 * elapsed-time budget runs out. A plan limit is terminal for that payload, so a
 * retryable status turns one rejection into an unbounded loop against a
 * customer who cannot succeed until they upgrade.
 *
 * The code stays `ERR_PLAN_LIMIT`: it is the discriminant SDKs and the AI
 * gateway already match on, and the serialised body puts it in the same `error`
 * field the hand-rolled response used.
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
