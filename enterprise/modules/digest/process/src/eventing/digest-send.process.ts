// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The weekly send's two processes. An hourly wake from Monday 08:00 UTC hands the outbox one
 * plan of last week; the plan asks one send per enrolled member, and each ask becomes one
 * `sendDigest` intent keyed by the person and week within the asking organization, so a second
 * ask or wake queues nothing more. Across organizations the send's claim keeps it to one email.
 * Spec: enterprise/modules/digest/specs/digest.feature
 */
import type { EventHandler, IntentSpec, WakeHandler } from "@langwatch/eventing";
import { z } from "zod";

import { plannableWeek } from "../rules/digest-week.rules.ts";
import {
  type DigestSendRequest,
  digestSendRequestedEventDataSchema,
} from "./digest-send.events.ts";

export const DIGEST_PLAN_PROCESS_NAME = "digestWeeklyPlan" as const;
export const DIGEST_MEMBER_SEND_PROCESS_NAME = "digestMemberSend" as const;

/** Hourly: the send goes out within the hour after Monday 08:00 UTC. */
export const DIGEST_PLAN_INTERVAL_MS = 60 * 60 * 1000;

export const planWeekIntentSchema = z.object({
  isoWeek: z.string().min(1),
  /** The wake's slot: the plan's instant, and what the fold sweep counts back from. */
  at: z.number().int().nonnegative(),
});
export type PlanWeekIntent = z.infer<typeof planWeekIntentSchema>;

export const sendDigestIntentSchema = digestSendRequestedEventDataSchema.extend({
  at: z.number().int().nonnegative(),
});
export type SendDigestIntent = z.infer<typeof sendDigestIntentSchema>;

export const digestPlanStateSchema = z.object({ lastWakeAt: z.number().nullable() });
type DigestPlanState = z.infer<typeof digestPlanStateSchema>;
export const DIGEST_PLAN_INITIAL_STATE: DigestPlanState = { lastWakeAt: null };

export const digestMemberSendStateSchema = z.object({ requestedAt: z.number().nullable() });
type DigestMemberSendState = z.infer<typeof digestMemberSendStateSchema>;
export const DIGEST_MEMBER_SEND_INITIAL_STATE: DigestMemberSendState = { requestedAt: null };

type PlanIntents = { planWeek: IntentSpec<typeof planWeekIntentSchema> };
type MemberSendIntents = { sendDigest: IntentSpec<typeof sendDigestIntentSchema> };

/**
 * Pure: asks for last week on every wake from Monday 08:00 UTC, and nothing before it. The plan
 * is the gate (armed, not yet planned), so arming mid-week still sends last week, arming early
 * on Monday waits for 08:00, and a planned week is never planned again.
 */
export const digestPlanWake: WakeHandler<DigestPlanState, PlanIntents> = (_state, context) => {
  const isoWeek = plannableWeek(context.at);
  return {
    state: { lastWakeAt: context.at },
    intents:
      isoWeek === null
        ? []
        : [context.intent("planWeek", `plan:${context.at}`, { isoWeek, at: context.at })],
  };
};

/** One person's week: the first ask becomes the `sendDigest`; its key dedupes a redelivery. */
export const digestSendRequested: EventHandler<
  DigestMemberSendState,
  DigestSendRequest,
  MemberSendIntents
> = (state, data, context) => ({
  state: { requestedAt: state.requestedAt ?? context.at },
  intents: [
    context.intent("sendDigest", `send:${data.userId}:${data.isoWeek}`, {
      ...data,
      at: context.at,
    }),
  ],
});
