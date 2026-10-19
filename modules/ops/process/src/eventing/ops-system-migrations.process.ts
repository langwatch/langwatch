import {
  type EventHandler,
  type IntentSpec,
  SCHEDULED_SINGLETON_PROJECT_ID,
  type WakeHandler,
} from "@langwatch/eventing";
import { z } from "zod";

/** Main's re-drive cadence once nothing is pending: a fixed blocker heals within the hour. */
export const SYSTEM_MIGRATION_REDRIVE_INTERVAL_MS = 60 * 60_000;

/** How often the singleton wakes to decide: a pending pass follows within one wake. */
export const SYSTEM_MIGRATION_WAKE_INTERVAL_MS = 60_000;

/**
 * Who tells the process a pass left work pending: the scheduled singleton's tenant, which the
 * tenant directory places on the shared cluster. Its request sets the flag; the next wake runs.
 */
export const SYSTEM_MIGRATION_FOLLOW_UP_REQUESTER = SCHEDULED_SINGLETON_PROJECT_ID;

export const systemMigrationPassIntentSchema = z.object({
  /** A re-drive runs only when a tenant could still move; an operator's kick always runs. */
  redrive: z.boolean(),
  /** False on a wake with nothing pending inside the hour: only a process's first pass runs. */
  due: z.boolean().default(true),
  requestedAt: z.number().int(),
});

export const systemMigrationPassStateSchema = z.object({
  lastRequestedAt: z.number().nullable(),
  /** The last pass left a tenant that can still move without an operator. */
  pending: z.boolean().default(false),
});
type SystemMigrationPassState = z.infer<typeof systemMigrationPassStateSchema>;

export const SYSTEM_MIGRATION_PASS_INITIAL_STATE: SystemMigrationPassState = {
  lastRequestedAt: null,
  pending: false,
};

type SystemMigrationPassIntents = {
  runPass: IntentSpec<typeof systemMigrationPassIntentSchema>;
};

/**
 * Due when nothing has run yet, the last pass left work pending, or an hour has passed; the pass
 * is keyed by the wake, so a redelivered wake asks once. A wake that is not due still reaches a
 * worker's first pass after boot.
 */
export const systemMigrationRedriveWake: WakeHandler<
  SystemMigrationPassState,
  SystemMigrationPassIntents
> = (state, ctx) => {
  const due =
    state.lastRequestedAt === null ||
    state.pending ||
    ctx.at - state.lastRequestedAt >= SYSTEM_MIGRATION_REDRIVE_INTERVAL_MS;
  return {
    state: due ? { lastRequestedAt: ctx.at, pending: false } : state,
    intents: [
      ctx.intent("runPass", `redrive:${ctx.at}`, { redrive: true, due, requestedAt: ctx.at }),
    ],
  };
};

/**
 * An operator's kick asks for its pass at once, keyed by the request. The singleton's own request
 * only flags the pass as pending: the next wake runs it.
 */
export const systemMigrationPassRequested: EventHandler<
  SystemMigrationPassState,
  Record<string, never>,
  SystemMigrationPassIntents
> = (state, _data, ctx) => {
  if (ctx.projectId === SYSTEM_MIGRATION_FOLLOW_UP_REQUESTER) {
    return { state: { ...state, pending: true } };
  }
  return {
    state: { ...state, lastRequestedAt: ctx.at },
    intents: [
      ctx.intent("runPass", `operator:${ctx.projectId}:${ctx.at}`, {
        redrive: false,
        requestedAt: ctx.at,
      }),
    ],
  };
};
