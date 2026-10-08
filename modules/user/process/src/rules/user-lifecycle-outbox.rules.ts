/**
 * User's fact outbox (Alex, round 35): a mint, a registration or an erasure appends its fact as an
 * intent in its own transaction, and the worker's outbox records it on user_lifecycle. A fact is
 * never lost to a down bus, and never written for a change that rolled back.
 */
import type { ProcessStore } from "@langwatch/eventing";
import type {
  UserCreatedEventData,
  UserLifecycleEventData,
  UserRegisteredEventData,
} from "@langwatch/user-contract";

export const USER_FACTS_PROCESS_NAME = "userLifecycleFacts" as const;
export const USER_FACTS_RECORD_CREATED_INTENT = "recordCreated" as const;
export const USER_FACTS_RECORD_REGISTERED_INTENT = "recordRegistered" as const;
export const USER_FACTS_RECORD_ERASED_INTENT = "recordErased" as const;
export const USER_FACTS_PRUNE_INTENT = "pruneFacts" as const;
/** Each user's one outbox instance. */
const USER_FACTS_PROCESS_KEY = "facts";

/** One fact a write commits with, named by the intent that records it. */
export type UserFactIntent =
  | Readonly<{ type: typeof USER_FACTS_RECORD_CREATED_INTENT; data: UserCreatedEventData }>
  | Readonly<{ type: typeof USER_FACTS_RECORD_REGISTERED_INTENT; data: UserRegisteredEventData }>
  | Readonly<{ type: typeof USER_FACTS_RECORD_ERASED_INTENT; data: UserLifecycleEventData }>;

type UserFactAppend = Omit<Parameters<ProcessStore["appendIntents"]>[0], "transaction">;

/** The key a fact's intent and its event share: once per user and kind. */
export function userFactKey(intent: UserFactIntent): string {
  const kind = {
    [USER_FACTS_RECORD_CREATED_INTENT]: "created",
    [USER_FACTS_RECORD_REGISTERED_INTENT]: "registered",
    [USER_FACTS_RECORD_ERASED_INTENT]: "erased",
  }[intent.type];
  return `${intent.data.userId}:${kind}`;
}

/** The outbox append that carries the facts one write commits with, all for one user. */
export function userFactsAppend({
  userId,
  intents,
  now,
}: {
  userId: string;
  intents: readonly UserFactIntent[];
  now: number;
}): UserFactAppend {
  return {
    ref: {
      processName: USER_FACTS_PROCESS_NAME,
      projectId: userId,
      processKey: USER_FACTS_PROCESS_KEY,
    },
    tenantId: userId,
    sourceEventId: null,
    messages: intents.map((intent) => ({
      messageKey: userFactKey(intent),
      intentType: intent.type,
      payload: intent.data,
      traceCarrier: {},
    })),
    now,
  };
}
