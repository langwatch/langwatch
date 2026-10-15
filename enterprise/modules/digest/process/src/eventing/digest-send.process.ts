// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { IntentSpec, WakeHandler } from "@langwatch/eventing";
import { z } from "zod";

import { sendableWeek } from "../rules/digest-week.rules.ts";

export const DIGEST_SEND_PROCESS_NAME = "digestWeeklySend";
/** Hourly: the send goes out within the hour after Monday 08:00 UTC. */
export const DIGEST_SEND_INTERVAL_MS = 60 * 60 * 1000;

export const digestSendIntentSchema = z.object({ isoWeek: z.string().min(1) });

export const digestSendStateSchema = z.object({ lastWakeAt: z.number().nullable() });
export type DigestSendState = z.infer<typeof digestSendStateSchema>;
export const DIGEST_SEND_INITIAL_STATE: DigestSendState = { lastWakeAt: null };

export type DigestSendIntents = { sendWeek: IntentSpec<typeof digestSendIntentSchema> };

/**
 * Pure: asks for the finished week every wake. The intent is the gate (armed, not yet planned),
 * so arming mid-week still sends, and a planned week is never sent twice.
 */
export const digestSendWake: WakeHandler<DigestSendState, DigestSendIntents> = (_state, ctx) => {
  const isoWeek = sendableWeek(ctx.at);
  return {
    state: { lastWakeAt: ctx.at },
    intents: [ctx.intent("sendWeek", `send:${isoWeek}:${ctx.at}`, { isoWeek })],
  };
};
