/**
 * User's fact outbox instance (Alex, round 35): writes append fact intents to it in their own
 * transaction, the worker records each on user_lifecycle, and a daily wake prunes the delivered
 * rows, as organization's audit outbox does.
 */
import type { IntentExecutor, IntentSpec, ProcessStore, WakeHandler } from "@langwatch/eventing";
import { nowInstant } from "@langwatch/time";
import type {
  userCreatedEventDataSchema,
  userLifecycleEventDataSchema,
  userRegisteredEventDataSchema,
} from "@langwatch/user-contract";
import { z } from "zod";

import {
  USER_FACTS_PROCESS_NAME,
  USER_FACTS_PRUNE_INTENT,
  type USER_FACTS_RECORD_CREATED_INTENT,
  type USER_FACTS_RECORD_ERASED_INTENT,
  type USER_FACTS_RECORD_REGISTERED_INTENT,
} from "../rules/user-lifecycle-outbox.rules.ts";

/** A fact is worth a day of retries; a dead one stays visible on the ops outbox page. */
export const USER_FACTS_MAX_ATTEMPTS = 12;
/** Delivered intents are kept two days for diagnosis, then pruned daily. */
const USER_FACTS_RETENTION_MS = 2 * 24 * 60 * 60 * 1000;
export const USER_FACTS_PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;

export const userFactsPruneSchema = z.object({ scheduledFor: z.number().int() });
export const userFactsStateSchema = z.object({ lastPruneAt: z.number().nullable() });
type UserFactsState = z.infer<typeof userFactsStateSchema>;
export const USER_FACTS_INITIAL_STATE: UserFactsState = { lastPruneAt: null };

type UserFactsIntents = {
  [USER_FACTS_RECORD_CREATED_INTENT]: IntentSpec<typeof userCreatedEventDataSchema>;
  [USER_FACTS_RECORD_REGISTERED_INTENT]: IntentSpec<typeof userRegisteredEventDataSchema>;
  [USER_FACTS_RECORD_ERASED_INTENT]: IntentSpec<typeof userLifecycleEventDataSchema>;
  [USER_FACTS_PRUNE_INTENT]: IntentSpec<typeof userFactsPruneSchema>;
};

export const userFactsPruneWake: WakeHandler<UserFactsState, UserFactsIntents> = (_state, ctx) => ({
  state: { lastPruneAt: ctx.at },
  intents: [ctx.intent(USER_FACTS_PRUNE_INTENT, `prune:${ctx.at}`, { scheduledFor: ctx.at })],
});

/** The daily prune of delivered fact intents. */
export function pruneUserFactIntents(
  retention: Pick<ProcessStore, "deleteDispatchedBefore">,
): IntentExecutor<z.infer<typeof userFactsPruneSchema>> {
  return async () => {
    await retention.deleteDispatchedBefore({
      processName: USER_FACTS_PROCESS_NAME,
      before: nowInstant().epochMilliseconds - USER_FACTS_RETENTION_MS,
    });
  };
}
