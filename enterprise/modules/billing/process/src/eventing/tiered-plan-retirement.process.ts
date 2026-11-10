// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * A Growth seat subscription that supersedes live tiered plans asks for their retirement, once
 * per fact. Spec: enterprise/modules/billing/specs/stripe-webhook.feature
 */
import type { SupersededPlansFoundEventData } from "@langwatch/enterprise-billing-contract";
import type { EventHandler, IntentSpec } from "@langwatch/eventing";
import { z } from "zod";

import { supersededPlansFoundKey } from "./billing-lifecycle.commands.ts";

export const TIERED_PLAN_RETIREMENT_PROCESS_NAME = "tieredPlanRetirement";

export const retireTieredPlansIntentSchema = z.object({
  organizationId: z.string().min(1),
  seatStripeSubscriptionId: z.string().min(1),
});
export type RetireTieredPlansIntent = z.infer<typeof retireTieredPlansIntentSchema>;

export const tieredPlanRetirementStateSchema = z.object({
  /** When the organization last found tiered plans to retire (epoch ms). */
  lastFoundAt: z.number().nullable(),
});
type TieredPlanRetirementState = z.infer<typeof tieredPlanRetirementStateSchema>;

export const TIERED_PLAN_RETIREMENT_INITIAL_STATE: TieredPlanRetirementState = {
  lastFoundAt: null,
};

type TieredPlanRetirementIntents = {
  retireTieredPlans: IntentSpec<typeof retireTieredPlansIntentSchema>;
};

/** Pure: the intent's key is the fact's own identity, so a redelivered fact asks once. */
export const tieredPlanRetirementSupersededPlansFound: EventHandler<
  TieredPlanRetirementState,
  SupersededPlansFoundEventData,
  TieredPlanRetirementIntents
> = (_state, data, ctx) => ({
  state: { lastFoundAt: data.occurredAt },
  intents: [
    ctx.intent("retireTieredPlans", supersededPlansFoundKey(data), {
      organizationId: data.organizationId,
      seatStripeSubscriptionId: data.seatStripeSubscriptionId,
    }),
  ],
});
