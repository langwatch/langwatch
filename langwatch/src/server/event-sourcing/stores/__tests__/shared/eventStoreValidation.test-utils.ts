import type { ExpectStatic } from "vitest";
import type { EventStore } from "../../../library";
import type { Event } from "../../../library";
import type { AggregateType } from "../../../library/core/aggregateType";
import type { EventStoreReadContext } from "../../../library";
import { createTenantId } from "../../../library/core/tenantId";

export function createEventStoreValidationTests<
  AggregateId = string,
  EventType extends Event<AggregateId> = Event<AggregateId>,
>(options: {
  describe: (name: string, fn: () => void) => void;
  it: (name: string, fn: () => void | Promise<void>) => void;
  expect: ExpectStatic;
  createStore: () => EventStore<AggregateId, EventType>;
  aggregateType: AggregateType;
  getStoreName: () => string;
  onStoreEventsSuccess?: (
    store: EventStore<AggregateId, EventType>,
  ) => void | Promise<void>;
  onStoreEventsFailure?: (
    store: EventStore<AggregateId, EventType>,
  ) => void | Promise<void>;
}): void {
  const {
    describe: describeFn,
    it: itFn,
    expect: expectFn,
    createStore,
    aggregateType,
    getStoreName,
    onStoreEventsSuccess,
    onStoreEventsFailure,
  } = options;

  describeFn(`${getStoreName()} - Event Validation`, () => {
    const tenantId = createTenantId("test-tenant");
    const context: EventStoreReadContext<AggregateId, EventType> = { tenantId };

    describeFn("storeEvents", () => {
      itFn("rejects invalid events - missing aggregateId", async () => {
        const store = createStore();
        const invalidEvent = {
          timestamp: 1000,
          type: "TEST" as any,
          data: {},
        } as any;

        // Different stores may check security (tenantId) before validation
        // (we should move this into the service, so it's consistent across stores/repositories)
        await expectFn(
          store.storeEvents([invalidEvent], context, aggregateType),
        ).rejects.toThrow(/\[(VALIDATION|SECURITY)\]/);

        if (onStoreEventsFailure) {
          await onStoreEventsFailure(store);
        }
      });

      itFn("rejects invalid events - missing timestamp", async () => {
        const store = createStore();
        const invalidEvent = {
          aggregateId: "test-1",
          type: "TEST" as any,
          data: {},
        } as any;

        // Different stores may check security (tenantId) before validation
        await expectFn(
          store.storeEvents([invalidEvent], context, aggregateType),
        ).rejects.toThrow(/\[(VALIDATION|SECURITY)\]/);

        if (onStoreEventsFailure) {
          await onStoreEventsFailure(store);
        }
      });

      itFn("rejects invalid events - missing type", async () => {
        const store = createStore();
        const invalidEvent = {
          aggregateId: "test-1",
          timestamp: 1000,
          data: {},
        } as any;

        // Different stores may check security (tenantId) before validation
        await expectFn(
          store.storeEvents([invalidEvent], context, aggregateType),
        ).rejects.toThrow(/\[(VALIDATION|SECURITY)\]/);

        if (onStoreEventsFailure) {
          await onStoreEventsFailure(store);
        }
      });

      itFn("rejects invalid events - missing data", async () => {
        const store = createStore();
        const invalidEvent = {
          aggregateId: "test-1",
          timestamp: 1000,
          type: "TEST" as any,
        } as any;

        // Different stores may check security (tenantId) before validation
        await expectFn(
          store.storeEvents([invalidEvent], context, aggregateType),
        ).rejects.toThrow(/\[(VALIDATION|SECURITY)\]/);

        if (onStoreEventsFailure) {
          await onStoreEventsFailure(store);
        }
      });

      itFn("rejects events with tenantId mismatch", async () => {
        const store = createStore();
        const event = {
          aggregateId: "test-1",
          tenantId: createTenantId("different-tenant"),
          timestamp: 1000,
          type: "TEST" as any,
          data: {},
        } satisfies Event<string> as EventType;

        await expectFn(
          store.storeEvents([event], context, aggregateType),
        ).rejects.toThrow("[SECURITY] Event at index 0 has tenantId");

        if (onStoreEventsFailure) {
          await onStoreEventsFailure(store);
        }
      });

      itFn("accepts valid events with matching tenantId", async () => {
        const store = createStore();
        const event = {
          aggregateId: "test-1",
          tenantId,
          timestamp: 1000,
          type: "TEST" as any,
          data: {},
        } as EventType;

        await expectFn(
          store.storeEvents([event], context, aggregateType),
        ).resolves.not.toThrow();

        if (onStoreEventsSuccess) {
          await onStoreEventsSuccess(store);
        }
      });

      itFn("rejects batch with one invalid event", async () => {
        const store = createStore();
        const validEvent = {
          aggregateId: "test-1",
          tenantId,
          timestamp: 1000,
          type: "TEST" as any,
          data: {},
        };
        const invalidEvent = {
          aggregateId: "test-2",
          timestamp: 1000,
          type: "TEST" as any,
          // missing data
        } as any;

        // Different stores may check security (tenantId) before validation
        await expectFn(
          store.storeEvents([validEvent, invalidEvent], context, aggregateType),
        ).rejects.toThrow(/\[(VALIDATION|SECURITY)\].*index 1/);

        if (onStoreEventsFailure) {
          await onStoreEventsFailure(store);
        }
      });

      itFn("rejects batch with tenantId mismatch in second event", async () => {
        const store = createStore();
        const validEvent = {
          aggregateId: "test-1",
          tenantId,
          timestamp: 1000,
          type: "TEST" as any,
          data: {},
        } as EventType;
        const mismatchedEvent = {
          aggregateId: "test-2",
          tenantId: createTenantId("different-tenant"),
          timestamp: 1000,
          type: "TEST" as any,
          data: {},
        } as EventType;

        await expectFn(
          store.storeEvents(
            [validEvent, mismatchedEvent],
            context,
            aggregateType,
          ),
        ).rejects.toThrow("[SECURITY] Event at index 1 has tenantId");

        if (onStoreEventsFailure) {
          await onStoreEventsFailure(store);
        }
      });

      itFn("accepts empty event array", async () => {
        const store = createStore();
        await expectFn(
          store.storeEvents([], context, aggregateType),
        ).resolves.not.toThrow();

        // Empty arrays may or may not trigger success callbacks depending on implementation
        // Only call if provided and if it makes sense for the store
        if (onStoreEventsSuccess) {
          try {
            await onStoreEventsSuccess(store);
          } catch {
            // Some stores don't call insert for empty arrays, which is fine
          }
        }
      });
    });
  });
}
