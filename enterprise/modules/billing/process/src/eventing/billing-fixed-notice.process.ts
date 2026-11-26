// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { IntentSpec, WakeHandler } from "@langwatch/eventing";
import { z } from "zod";

export const BILLING_FIXED_NOTICE_PIPELINE_NAME = "billing_fixed_notice";
export const BILLING_FIXED_NOTICE_PROCESS_NAME = "billingFixedNotice";

/** Every 15 minutes: an admin hears soon after ops or billing itself sorts the plans out. */
export const BILLING_FIXED_NOTICE_INTERVAL_MS = 15 * 60 * 1000;

export const billingFixedNoticeSchema = z.object({ scheduledFor: z.number().int() });

export const billingFixedNoticeStateSchema = z.object({ lastPassAt: z.number().nullable() });
type BillingFixedNoticeState = z.infer<typeof billingFixedNoticeStateSchema>;

export const BILLING_FIXED_NOTICE_INITIAL_STATE: BillingFixedNoticeState = { lastPassAt: null };

type BillingFixedNoticeIntents = { notice: IntentSpec<typeof billingFixedNoticeSchema> };

/** Pure and synchronous: the pass itself is an intent, run behind the outbox lease. */
export const billingFixedNoticeWake: WakeHandler<
  BillingFixedNoticeState,
  BillingFixedNoticeIntents
> = (_state, ctx) => ({
  state: { lastPassAt: ctx.at },
  intents: [ctx.intent("notice", `notice:${ctx.at}`, { scheduledFor: ctx.at })],
});
