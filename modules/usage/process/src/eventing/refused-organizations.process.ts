import type { EventHandler, IntentSpec, WakeHandler } from "@langwatch/eventing";
import type { MonthCountedEventData } from "@langwatch/usage-contract";
import { z } from "zod";

import { decideLimit, type LimitState } from "../rules/usage-limit.rules.ts";
import { UsageCountingService } from "../services/usage-counting.service.ts";
import type {
  countMonthCommandDataSchema,
  recordLimitDecisionCommandDataSchema,
} from "./usage.events.ts";

export const REFUSED_ORGANIZATIONS_PROCESS_NAME = "refusedOrganizations";

/** How often a refused organization is recounted, so an upgrade clears within minutes. */
export const REFUSED_ORGANIZATIONS_WAKE_MS = 5 * 60 * 1000;

export const limitStateSchema = z.object({ month: z.string().nullable(), reached: z.boolean() });

type Intents = {
  recordLimitDecision: IntentSpec<typeof recordLimitDecisionCommandDataSchema>;
  countMonth: IntentSpec<typeof countMonthCommandDataSchema>;
};

/** Decides each counted month once per change, keyed by organization. */
export const monthCounted: EventHandler<LimitState, MonthCountedEventData, Intents> = (
  state,
  data,
  ctx,
) => {
  const { state: next, decision } = decideLimit({ state, counted: data });
  // A refusal arms the recount; anything else clears it.
  const wakeAt = next.reached ? Math.max(ctx.at, ctx.now) + REFUSED_ORGANIZATIONS_WAKE_MS : null;
  if (decision === "none") return { state: next, nextWakeAt: wakeAt };
  const payload = {
    tenantId: data.organizationId,
    organizationId: data.organizationId,
    month: data.month,
    occurredAt: data.occurredAt,
    count: data.billableEvents,
    ...data.limit,
    decision,
  };
  return {
    state: next,
    nextWakeAt: wakeAt,
    intents: [
      ctx.intent(
        "recordLimitDecision",
        `${data.organizationId}:${data.month}:${decision}:${data.occurredAt}`,
        payload,
      ),
    ],
  };
};

/** A refused organization is recounted each wake and re-armed; any other wakes to nothing. */
export const refusedOrganizationWake: WakeHandler<LimitState, Intents> = (state, ctx) => {
  const now = Math.max(ctx.at, ctx.now);
  if (!state.reached) return { state, nextWakeAt: null };
  const month = UsageCountingService.monthOf(now);
  const payload = { tenantId: ctx.key, organizationId: ctx.key, month, occurredAt: ctx.now };
  return {
    state,
    nextWakeAt: now + REFUSED_ORGANIZATIONS_WAKE_MS,
    intents: [ctx.intent("countMonth", `recount:${ctx.key}:${ctx.at}`, payload)],
  };
};
