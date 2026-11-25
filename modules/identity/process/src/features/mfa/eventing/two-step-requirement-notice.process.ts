import type { EventHandler, IntentSpec } from "@langwatch/eventing";
import { z } from "zod";

export const TWO_STEP_REQUIREMENT_NOTICE_PROCESS_NAME = "twoStepRequirementNotice" as const;

export const notifyMembersIntentSchema = z.object({
  organizationId: z.string().min(1),
  required: z.boolean(),
  actorUserId: z.string().min(1),
});

/** Nothing is remembered: the fact carries everything its notices need. */
export const twoStepRequirementNoticeStateSchema = z.record(z.string(), z.never());
export type TwoStepRequirementNoticeState = z.infer<typeof twoStepRequirementNoticeStateSchema>;

export const TWO_STEP_REQUIREMENT_NOTICE_INITIAL_STATE: TwoStepRequirementNoticeState = {};

export type TwoStepRequirementNoticeIntents = {
  notifyMembers: IntentSpec<typeof notifyMembersIntentSchema>;
};

/** Where the notices reach members; the service behind it decides who reads them. */
export interface TwoStepRequirementNotices {
  notifyRequirementChanged(args: {
    /** The intent's own key: one per change, the root of each member's delivery key. */
    notificationKey: string;
    organizationId: string;
    actorUserId: string;
    required: boolean;
  }): Promise<void>;
}

/** One key per change, so a redelivered fact is the same intent and the outbox collapses it. */
function notificationKey(data: { organizationId: string; required: boolean; occurredAt: number }) {
  return `two-step-requirement:${data.organizationId}:${data.required}:${data.occurredAt}`;
}

/** The requirement changed: one intent tells every active member, off the request. */
export const onTwoStepRequirementChanged: EventHandler<
  TwoStepRequirementNoticeState,
  { organizationId: string; required: boolean; actorUserId: string; occurredAt: number },
  TwoStepRequirementNoticeIntents
> = (state, data, ctx) => ({
  state,
  intents: [
    ctx.intent("notifyMembers", notificationKey(data), {
      organizationId: data.organizationId,
      required: data.required,
      actorUserId: data.actorUserId,
    }),
  ],
});
