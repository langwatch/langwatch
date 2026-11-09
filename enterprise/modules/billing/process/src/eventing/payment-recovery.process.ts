// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { IntentSpec, WakeHandler } from "@langwatch/eventing";
import { z } from "zod";

export const PAYMENT_RECOVERY_PIPELINE_NAME = "billing_payment_recovery";
export const PAYMENT_RECOVERY_PROCESS_NAME = "paymentRecovery";

/** Hourly: each notice goes out within an hour of its day, and access stops on time without it. */
export const PAYMENT_RECOVERY_INTERVAL_MS = 60 * 60 * 1000;

export const paymentRecoverySweepSchema = z.object({ scheduledFor: z.number().int() });

export const paymentRecoveryStateSchema = z.object({ lastSweepAt: z.number().nullable() });
type PaymentRecoveryState = z.infer<typeof paymentRecoveryStateSchema>;

export const PAYMENT_RECOVERY_INITIAL_STATE: PaymentRecoveryState = { lastSweepAt: null };

type PaymentRecoveryIntents = { sweep: IntentSpec<typeof paymentRecoverySweepSchema> };

/** Pure and synchronous: the sweep itself is an intent, run behind the outbox lease. */
export const paymentRecoveryWake: WakeHandler<PaymentRecoveryState, PaymentRecoveryIntents> = (
  _state,
  ctx,
) => ({
  state: { lastSweepAt: ctx.at },
  intents: [ctx.intent("sweep", `sweep:${ctx.at}`, { scheduledFor: ctx.at })],
});
