// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The weekly send's two processes. An hourly wake from Monday 08:00 UTC hands the outbox one
 * plan of last week; the plan asks one organization plan per organization (paged), each its own
 * intent, which asks one send per member; each ask
 * becomes one `sendDigest` intent keyed by the person, organization and week, so a second ask or
 * wake queues nothing more and a person in two organizations has two.
 * Spec: enterprise/modules/digest/specs/digest.feature
 */
import type { EventHandler, IntentSpec, WakeHandler } from "@langwatch/eventing";
import { z } from "zod";

import { digestMessageId } from "../rules/digest-email.rules.ts";
import { plannableWeek } from "../rules/digest-week.rules.ts";
import {
  type DigestOrganizationPlanRequest,
  digestOrganizationPlanRequestedEventDataSchema,
  type DigestSendRequest,
  digestSendRequestedEventDataSchema,
} from "./digest-send.events.ts";

export const DIGEST_PLAN_PROCESS_NAME = "digestWeeklyPlan" as const;
export const DIGEST_ORGANIZATION_PLAN_PROCESS_NAME = "digestOrganizationPlan" as const;
export const DIGEST_MEMBER_SEND_PROCESS_NAME = "digestMemberSend" as const;

/** Hourly: the send goes out within the hour after Monday 08:00 UTC. */
export const DIGEST_PLAN_INTERVAL_MS = 60 * 60 * 1000;

export const planWeekIntentSchema = z.object({
  isoWeek: z.string().min(1),
  /** The wake's slot: the plan's instant, and what the fold sweep counts back from. */
  at: z.number().int().nonnegative(),
});
export type PlanWeekIntent = z.infer<typeof planWeekIntentSchema>;

/** The ask as it was recorded; the event's own `occurredAt` already holds when it was asked. */
export const sendDigestIntentSchema = digestSendRequestedEventDataSchema;
export type SendDigestIntent = z.infer<typeof sendDigestIntentSchema>;

export const digestPlanStateSchema = z.object({ lastWakeAt: z.number().nullable() });
type DigestPlanState = z.infer<typeof digestPlanStateSchema>;
export const DIGEST_PLAN_INITIAL_STATE: DigestPlanState = { lastWakeAt: null };

export const planOrganizationIntentSchema = digestOrganizationPlanRequestedEventDataSchema;
export type PlanOrganizationIntent = z.infer<typeof planOrganizationIntentSchema>;

export const digestOrganizationPlanStateSchema = z.object({ requestedAt: z.number().nullable() });
type DigestOrganizationPlanState = z.infer<typeof digestOrganizationPlanStateSchema>;
export const DIGEST_ORGANIZATION_PLAN_INITIAL_STATE: DigestOrganizationPlanState = {
  requestedAt: null,
};

export const digestMemberSendStateSchema = z.object({ requestedAt: z.number().nullable() });
type DigestMemberSendState = z.infer<typeof digestMemberSendStateSchema>;
export const DIGEST_MEMBER_SEND_INITIAL_STATE: DigestMemberSendState = { requestedAt: null };

type PlanIntents = { planWeek: IntentSpec<typeof planWeekIntentSchema> };
type OrganizationPlanIntents = {
  planOrganization: IntentSpec<typeof planOrganizationIntentSchema>;
};
type MemberSendIntents = { sendDigest: IntentSpec<typeof sendDigestIntentSchema> };

/**
 * Pure: asks for last week on every wake from Monday 08:00 UTC, and nothing before it. The plan
 * is the gate (armed, not yet planned), so arming mid-week still sends last week, arming early
 * on Monday waits for 08:00, and a planned week is never planned again.
 */
export const digestPlanWake: WakeHandler<DigestPlanState, PlanIntents> = (_state, context) => {
  const plannable = plannableWeek(context.at);
  const state = { lastWakeAt: context.at };
  if (plannable.kind === "closed") return { state, intents: [] };
  const plan = { isoWeek: plannable.isoWeek, at: context.at };
  return { state, intents: [context.intent("planWeek", `plan:${context.at}`, plan)] };
};

/** One person's week in one organization: the first ask becomes the `sendDigest`; its key dedupes a redelivery. */
export const digestSendRequested: EventHandler<
  DigestMemberSendState,
  DigestSendRequest,
  MemberSendIntents
> = (state, data, context) => ({
  state: { requestedAt: state.requestedAt ?? context.at },
  intents: [context.intent("sendDigest", digestMessageId(data), data)],
});

/** One organization's week to plan: the first ask becomes the intent, keyed so a repeat queues nothing. */
export const digestOrganizationPlanRequested: EventHandler<
  DigestOrganizationPlanState,
  DigestOrganizationPlanRequest,
  OrganizationPlanIntents
> = (state, data, context) => ({
  state: { requestedAt: state.requestedAt ?? context.at },
  intents: [
    context.intent("planOrganization", `plan:${data.organizationId}:${data.isoWeek}`, data),
  ],
});
