import type { ScenarioRunsCountedEventData } from "@langwatch/entitlement-contract";
import type {
  EventHandler,
  IntentSpec,
  ProcessHandlerContext,
  WakeHandler,
} from "@langwatch/eventing";
import { z } from "zod";

import {
  decideGraceNotice,
  isThresholdReached,
  graceEndsAtOf,
} from "../rules/scenario-run-cap.rules.ts";
import type {
  recordScenarioRunGraceEndedCommandDataSchema,
  recordScenarioRunsThresholdCommandDataSchema,
} from "./usage.events.ts";

export const SCENARIO_RUN_NOTICES_PROCESS_NAME = "scenarioRunNotices";

export const scenarioRunNoticesStateSchema = z.object({
  /** The last month the threshold was recorded for. */
  thresholdMonth: z.string().nullable(),
  firstRunAt: z.number().nullable(),
  maxPerMonth: z.number(),
  graceDays: z.number(),
  /** True once the grace ended, with or without its notice. */
  graceClosed: z.boolean(),
});
export type ScenarioRunNoticesState = z.infer<typeof scenarioRunNoticesStateSchema>;

export const initialScenarioRunNoticesState: ScenarioRunNoticesState = {
  thresholdMonth: null,
  firstRunAt: null,
  maxPerMonth: 0,
  graceDays: 0,
  graceClosed: false,
};

type Intents = {
  recordScenarioRunsThreshold: IntentSpec<typeof recordScenarioRunsThresholdCommandDataSchema>;
  recordScenarioRunGraceEnded: IntentSpec<typeof recordScenarioRunGraceEndedCommandDataSchema>;
};

type GraceStep = {
  state: ScenarioRunNoticesState;
  nextWakeAt: number | null;
  ended: { firstRunAt: number; graceEndedAt: number } | null;
};

function graceStep(state: ScenarioRunNoticesState, now: number): GraceStep {
  if (state.graceClosed || state.firstRunAt === null) {
    return { state, nextWakeAt: null, ended: null };
  }
  const decision = decideGraceNotice({ firstRunAt: state.firstRunAt, cap: state, now });
  if (decision.kind === "running") return { state, nextWakeAt: decision.graceEndsAt, ended: null };
  const closed = { ...state, graceClosed: true };
  if (decision.kind === "closedSilently") return { state: closed, nextWakeAt: null, ended: null };
  return {
    state: closed,
    nextWakeAt: null,
    ended: { firstRunAt: state.firstRunAt, graceEndedAt: decision.graceEndsAt },
  };
}

/**
 * Records the heads-up once per month and arms the grace's wake, per organization.
 * @see specs/licensing/cloud-free-creation-caps.feature
 */
export const scenarioRunsCounted: EventHandler<
  ScenarioRunNoticesState,
  ScenarioRunsCountedEventData,
  Intents
> = (state, data, ctx) => {
  const now = Math.max(ctx.at, ctx.now);
  const known: ScenarioRunNoticesState = {
    ...state,
    firstRunAt: state.firstRunAt ?? data.firstRunAt,
    maxPerMonth: data.cap.maxPerMonth,
    graceDays: data.cap.graceDays,
  };
  if (known.firstRunAt === null) return { state: known, nextWakeAt: null };

  const intents = [];
  let next = known;
  const isNewMonth = state.thresholdMonth === null || data.month > state.thresholdMonth;
  if (isNewMonth && isThresholdReached({ runs: data.runs, cap: data.cap })) {
    const graceEndsAt = graceEndsAtOf({ firstRunAt: known.firstRunAt, cap: data.cap });
    next = { ...next, thresholdMonth: data.month };
    intents.push(
      ctx.intent("recordScenarioRunsThreshold", `${data.organizationId}:${data.month}`, {
        tenantId: data.organizationId,
        organizationId: data.organizationId,
        month: data.month,
        occurredAt: data.occurredAt,
        runs: data.runs,
        maxPerMonth: data.cap.maxPerMonth,
        inGrace: graceEndsAt !== null && data.occurredAt < graceEndsAt,
        graceEndsAt,
      }),
    );
  }

  const grace = graceStep(next, now);
  if (grace.ended) {
    intents.push(
      graceEndedIntent({
        ctx,
        key: data.organizationId,
        grace: { ...grace, ended: grace.ended },
        now,
      }),
    );
  }
  return { state: grace.state, nextWakeAt: grace.nextWakeAt, intents };
};

/** The grace's wake: records its end once, or re-arms while it still runs. */
export const scenarioRunGraceWake: WakeHandler<ScenarioRunNoticesState, Intents> = (state, ctx) => {
  const now = Math.max(ctx.at, ctx.now);
  const grace = graceStep(state, now);
  if (!grace.ended) return { state: grace.state, nextWakeAt: grace.nextWakeAt };
  return {
    state: grace.state,
    nextWakeAt: null,
    intents: [
      graceEndedIntent({ ctx, key: ctx.key, grace: { ...grace, ended: grace.ended }, now }),
    ],
  };
};

function graceEndedIntent({
  ctx,
  key,
  grace,
  now,
}: {
  ctx: ProcessHandlerContext<Intents>;
  key: string;
  grace: GraceStep & { ended: NonNullable<GraceStep["ended"]> };
  now: number;
}) {
  const { ended } = grace;
  return ctx.intent("recordScenarioRunGraceEnded", key, {
    tenantId: key,
    organizationId: key,
    occurredAt: now,
    firstRunAt: ended.firstRunAt,
    graceEndedAt: ended.graceEndedAt,
    maxPerMonth: grace.state.maxPerMonth,
  });
}
