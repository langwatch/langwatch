/**
 * @vitest-environment node
 *
 * user_lifecycle records an account's deactivation and reactivation; peers react from their side
 * (§9).
 * @see modules/user/specs/user.feature
 */
import { createTenantId, InMemoryProcessStore, OutboxDispatcherService } from "@langwatch/eventing";
import { nowInstant } from "@langwatch/time";
import {
  USER_CREATED_EVENT_TYPE,
  USER_DEACTIVATED_EVENT_TYPE,
  USER_ERASED_EVENT_TYPE,
  USER_LIFECYCLE_PIPELINE_NAME,
  USER_REACTIVATED_EVENT_TYPE,
  USER_REGISTERED_EVENT_TYPE,
} from "@langwatch/user-contract";
import { describe, expect, it, vi } from "vitest";

import {
  USER_FACTS_PROCESS_NAME,
  USER_FACTS_RECORD_CREATED_INTENT,
  USER_FACTS_RECORD_ERASED_INTENT,
  type UserFactIntent,
  userFactsAppend,
} from "../../rules/user-lifecycle-outbox.rules.ts";
import {
  RecordUserCreatedCommand,
  RecordUserDeactivatedCommand,
  RecordUserErasedCommand,
  RecordUserReactivatedCommand,
  RecordUserRegisteredCommand,
} from "../user-lifecycle.commands.ts";
import type { RecordUserLifecycleCommandData } from "../user-lifecycle.events.ts";
import { buildUserLifecyclePipeline } from "../user-lifecycle.pipeline.ts";

const FACT: RecordUserLifecycleCommandData = {
  tenantId: "user_1",
  userId: "user_1",
  occurredAt: Date.UTC(2026, 9, 1, 12),
};

function command(type: string) {
  return { tenantId: createTenantId("user_1"), aggregateId: "user_1", type, data: FACT };
}

describe("user's lifecycle pipeline", () => {
  /** @scenario "Deactivation and reactivation are recorded as user's facts" */
  it("records a deactivation on the user, keyed so a redelivery collapses", async () => {
    const [event] = await new RecordUserDeactivatedCommand().handle(
      command(RecordUserDeactivatedCommand.schema.type),
    );

    expect(event?.type).toBe(USER_DEACTIVATED_EVENT_TYPE);
    expect(event?.aggregateId).toBe("user_1");
    expect(event?.data).toEqual(FACT);
    expect(event?.idempotencyKey).toBe(`user_1:deactivated:${FACT.occurredAt}`);
  });

  /** @scenario "Deactivation and reactivation are recorded as user's facts" */
  it("records a reactivation the same way", async () => {
    const [event] = await new RecordUserReactivatedCommand().handle(
      command(RecordUserReactivatedCommand.schema.type),
    );

    expect(event?.type).toBe(USER_REACTIVATED_EVENT_TYPE);
    expect(event?.idempotencyKey).toBe(`user_1:reactivated:${FACT.occurredAt}`);
  });

  /** @scenario "A self-service registration is recorded as user's fact" */
  it("records a registration on the user, naming its credential row, keyed once per user", async () => {
    const registration = {
      ...FACT,
      accountId: "acc_1",
      createdAtMs: FACT.occurredAt,
      email: "sam@acme.com",
    };
    const [event] = await new RecordUserRegisteredCommand().handle({
      ...command(RecordUserRegisteredCommand.schema.type),
      data: registration,
    });

    expect(event?.type).toBe(USER_REGISTERED_EVENT_TYPE);
    expect(event?.aggregateId).toBe("user_1");
    expect(event?.data).toEqual(registration);
    expect(event?.idempotencyKey).toBe("user_1:registered");
  });

  /** @scenario "Every account mint records user's created fact" */
  it("records a creation on the user, keyed once per user, so the seed adds none twice", async () => {
    const [event] = await new RecordUserCreatedCommand().handle(
      command(RecordUserCreatedCommand.schema.type),
    );

    expect(event?.type).toBe(USER_CREATED_EVENT_TYPE);
    expect(event?.aggregateId).toBe("user_1");
    expect(event?.data).toEqual(FACT);
    expect(event?.idempotencyKey).toBe("user_1:created");
  });

  /** @scenario "An erasure records user's erased fact with the erase" */
  it("records an erasure on the user, keyed once per user", async () => {
    const [event] = await new RecordUserErasedCommand().handle(
      command(RecordUserErasedCommand.schema.type),
    );

    expect(event?.type).toBe(USER_ERASED_EVENT_TYPE);
    expect(event?.data).toEqual(FACT);
    expect(event?.idempotencyKey).toBe("user_1:erased");
  });

  it("hosts no reaction on its own events", () => {
    const definition = buildUserLifecyclePipeline({
      facts: { record: async () => undefined, retention: InMemoryProcessStore.createForTesting() },
    });

    expect(definition.metadata.name).toBe(USER_LIFECYCLE_PIPELINE_NAME);
    expect(definition.eventSubscribers.size).toBe(0);
  });
});

/** User's fact outbox over an in-memory process store, delivered as the worker's dispatcher. */
function factOutboxOver(record: (intent: UserFactIntent) => Promise<void>) {
  const store = InMemoryProcessStore.createForTesting();
  const pipeline = buildUserLifecyclePipeline({ facts: { record, retention: store } });
  const intents = pipeline.processManagers.get(USER_FACTS_PROCESS_NAME)?.config.intents;
  if (!intents) throw new Error("user_lifecycle declares no fact outbox");
  const handler =
    (type: string) =>
    ({ message }: { message: { messageKey: string; payload: unknown } }) => {
      const intent = intents[type];
      if (!intent) throw new Error(`no ${type} intent`);
      return intent.run(intent.schema.parse(message.payload), {
        processName: USER_FACTS_PROCESS_NAME,
        projectId: "user_1",
        processKey: "facts",
        tenantId: "user_1",
        messageKey: message.messageKey,
        attempt: 1,
      });
    };
  const dispatcher = new OutboxDispatcherService({
    store,
    processNames: [USER_FACTS_PROCESS_NAME],
    retryDelayMs: () => 0,
    handlers: {
      [USER_FACTS_RECORD_CREATED_INTENT]: handler(USER_FACTS_RECORD_CREATED_INTENT),
      [USER_FACTS_RECORD_ERASED_INTENT]: handler(USER_FACTS_RECORD_ERASED_INTENT),
    },
  });
  return { store, dispatcher };
}

describe("given facts a write committed to user's fact outbox", () => {
  /** @scenario "The fact outbox records each committed fact on user's pipeline" */
  it("records each on user_lifecycle once, however often the write is retried", async () => {
    const record = vi.fn(async (_intent: UserFactIntent) => undefined);
    const { store, dispatcher } = factOutboxOver(record);
    const append = userFactsAppend({
      userId: "user_1",
      intents: [
        { type: USER_FACTS_RECORD_CREATED_INTENT, data: FACT },
        { type: USER_FACTS_RECORD_ERASED_INTENT, data: FACT },
      ],
      now: FACT.occurredAt,
    });

    await store.appendIntents(append);
    await store.appendIntents(append);
    await dispatcher.runOnce({ now: nowInstant().epochMilliseconds + 1 });

    expect(record.mock.calls.map(([intent]) => intent)).toEqual([
      { type: USER_FACTS_RECORD_CREATED_INTENT, data: FACT },
      { type: USER_FACTS_RECORD_ERASED_INTENT, data: FACT },
    ]);
  });
});
