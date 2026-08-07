import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandHandler } from "../../../commands/command";
import type { CommandSchema } from "../../../commands/commandSchema";
import type { AggregateType } from "../../../domain/aggregateType";
import type { CommandType } from "../../../domain/commandType";
import { createTenantId } from "../../../domain/tenantId";
import type { Event } from "../../../domain/types";
import {
  createTestAggregateType,
  createTestEvent,
  createTestTenantId,
  TEST_CONSTANTS,
} from "../../__tests__/testHelpers";
import { ValidationError } from "../../errorHandling";
import type {
  ProcessCommandBatchParams,
  ProcessCommandParams,
} from "../commandDispatcher";
import { processCommand, processCommandBatch } from "../commandDispatcher";

// Mock the kill switch module
vi.mock("../../../utils/killSwitch", () => ({
  isComponentDisabled: vi.fn().mockResolvedValue(false),
}));

// Lazy import so the mock is applied before the module loads
import { isComponentDisabled } from "../../../utils/killSwitch";

const mockedIsComponentDisabled = vi.mocked(isComponentDisabled);

describe("processCommand", () => {
  const aggregateType: AggregateType = createTestAggregateType();
  const tenantId = createTestTenantId();
  const commandType: CommandType = "lw.obs.trace.record_span";
  const commandName = "recordSpan";

  // Valid payload that commandSchema.validate will "accept"
  const validPayload = {
    tenantId: TEST_CONSTANTS.TENANT_ID_VALUE,
    occurredAt: TEST_CONSTANTS.BASE_TIMESTAMP,
    someField: "value",
  };

  // Build a valid event via the test helper
  function makeValidEvent(overrides?: Partial<Event>): Event {
    return createTestEvent({
      aggregateId: overrides?.aggregateId ?? TEST_CONSTANTS.AGGREGATE_ID,
      aggregateType: overrides?.aggregateType ?? aggregateType,
      tenantId: overrides?.tenantId ?? tenantId,
      type: overrides?.type ?? TEST_CONSTANTS.EVENT_TYPE_1,
      createdAt: overrides?.createdAt ?? TEST_CONSTANTS.BASE_TIMESTAMP,
    });
  }

  // ---- Reusable mock factories ----

  function createMockCommandSchema(
    overrides?: Partial<CommandSchema<any, CommandType>>,
  ): CommandSchema<any, CommandType> {
    return {
      type: commandType,
      validate: vi.fn().mockReturnValue({
        success: true,
        data: validPayload,
      }),
      ...overrides,
    };
  }

  function createMockHandler(events?: Event[]): CommandHandler<any, Event> {
    return {
      handle: vi.fn().mockResolvedValue(events ?? [makeValidEvent()]),
    };
  }

  function createDefaultParams(
    overrides?: Partial<ProcessCommandParams<Event>>,
  ): ProcessCommandParams<Event> {
    return {
      payload: validPayload,
      commandType,
      commandSchema: createMockCommandSchema(),
      handler: createMockHandler(),
      getAggregateId: vi.fn().mockReturnValue(TEST_CONSTANTS.AGGREGATE_ID),
      storeEventsFn: vi.fn().mockResolvedValue(undefined),
      aggregateType,
      commandName,
      pipelineName: "test-pipeline",
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(TEST_CONSTANTS.BASE_TIMESTAMP);
    mockedIsComponentDisabled.mockResolvedValue(false);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ─── 1. Valid flow ──────────────────────────────────────────────

  describe("valid flow", () => {
    it("validates payload, invokes handler, and stores resulting events", async () => {
      const event = makeValidEvent();
      const handler = createMockHandler([event]);
      const storeEventsFn = vi.fn().mockResolvedValue(undefined);
      const commandSchema = createMockCommandSchema();

      const params = createDefaultParams({
        commandSchema,
        handler,
        storeEventsFn,
      });

      await processCommand(params);

      expect(commandSchema.validate).toHaveBeenCalledWith(validPayload);
      expect(handler.handle).toHaveBeenCalledOnce();
      expect(storeEventsFn).toHaveBeenCalledWith([event], {
        tenantId: createTenantId(String(validPayload.tenantId)),
      });
    });
  });

  // ─── 2. Schema validation failure ──────────────────────────────

  describe("schema validation failure", () => {
    it("throws ValidationError when commandSchema.validate returns failure", async () => {
      const commandSchema = createMockCommandSchema({
        validate: vi.fn().mockReturnValue({
          success: false,
          error: {
            issues: [
              { path: ["tenantId"], message: "Required", code: "invalid_type" },
            ],
          },
        }),
      });

      const params = createDefaultParams({ commandSchema });

      await expect(processCommand(params)).rejects.toThrow(ValidationError);
      await expect(processCommand(params)).rejects.toThrow(
        /Invalid payload for command type/,
      );
    });
  });

  // ─── 3. Kill switch enabled ────────────────────────────────────

  describe("kill switch enabled", () => {
    it("returns without calling handler when component is disabled", async () => {
      mockedIsComponentDisabled.mockResolvedValue(true);

      const handler = createMockHandler();
      const storeEventsFn = vi.fn();

      const params = createDefaultParams({ handler, storeEventsFn });

      await processCommand(params);

      expect(handler.handle).not.toHaveBeenCalled();
      expect(storeEventsFn).not.toHaveBeenCalled();
    });
  });

  // ─── 4. Handler returns undefined ──────────────────────────────

  describe("handler returns undefined", () => {
    it("throws ValidationError mentioning 'returned undefined'", async () => {
      const handler: CommandHandler<any, Event> = {
        handle: vi.fn().mockResolvedValue(undefined),
      };

      const params = createDefaultParams({ handler });

      await expect(processCommand(params)).rejects.toThrow(ValidationError);
      await expect(processCommand(params)).rejects.toThrow(
        /returned undefined/,
      );
    });
  });

  // ─── 5. Handler returns non-array ──────────────────────────────

  describe("handler returns non-array value", () => {
    it("throws ValidationError mentioning 'non-array value'", async () => {
      const handler: CommandHandler<any, Event> = {
        handle: vi.fn().mockResolvedValue("not-an-array" as any),
      };

      const params = createDefaultParams({ handler });

      await expect(processCommand(params)).rejects.toThrow(ValidationError);
      await expect(processCommand(params)).rejects.toThrow(/non-array value/);
    });
  });

  // ─── 6. Handler returns array with undefined at index ──────────

  describe("handler returns array with undefined element", () => {
    it("throws ValidationError mentioning the index", async () => {
      const handler: CommandHandler<any, Event> = {
        handle: vi
          .fn()
          .mockResolvedValue([makeValidEvent(), undefined, makeValidEvent()]),
      };

      const params = createDefaultParams({ handler });

      await expect(processCommand(params)).rejects.toThrow(ValidationError);
      await expect(processCommand(params)).rejects.toThrow(
        /undefined at index 1/,
      );
    });
  });

  // ─── 7. Handler returns invalid event ──────────────────────────

  describe("handler returns invalid event", () => {
    it("throws ValidationError with zod validation details", async () => {
      const invalidEvent = { id: "some-id" }; // missing required fields
      const handler: CommandHandler<any, Event> = {
        handle: vi.fn().mockResolvedValue([invalidEvent]),
      };

      const params = createDefaultParams({ handler });

      await expect(processCommand(params)).rejects.toThrow(ValidationError);
      await expect(processCommand(params)).rejects.toThrow(
        /invalid event at index 0/,
      );
    });
  });

  // ─── 8. Handler returns empty array ────────────────────────────

  describe("handler returns empty array", () => {
    it("does not call storeEventsFn", async () => {
      const handler = createMockHandler([]);
      const storeEventsFn = vi.fn();

      const params = createDefaultParams({ handler, storeEventsFn });

      await processCommand(params);

      expect(storeEventsFn).not.toHaveBeenCalled();
    });
  });

  // ─── 9. Correct tenantId extraction ────────────────────────────

  describe("tenantId extraction", () => {
    it("uses createTenantId(String(validated.tenantId)) for tenant isolation", async () => {
      const numericTenantPayload = {
        tenantId: 12345,
        occurredAt: TEST_CONSTANTS.BASE_TIMESTAMP,
      };

      const commandSchema = createMockCommandSchema({
        validate: vi.fn().mockReturnValue({
          success: true,
          data: numericTenantPayload,
        }),
      });

      const storeEventsFn = vi.fn().mockResolvedValue(undefined);
      const handler = createMockHandler();

      const params = createDefaultParams({
        commandSchema,
        handler,
        storeEventsFn,
        payload: numericTenantPayload as any,
      });

      await processCommand(params);

      // storeEventsFn should receive the stringified tenantId
      const expectedTenantId = createTenantId("12345");
      expect(storeEventsFn).toHaveBeenCalledWith(expect.any(Array), {
        tenantId: expectedTenantId,
      });
    });

    it("passes validated payload (not raw) to getAggregateId", async () => {
      const getAggregateId = vi.fn().mockReturnValue("agg-from-validated");
      const commandSchema = createMockCommandSchema();

      const params = createDefaultParams({ getAggregateId, commandSchema });

      await processCommand(params);

      expect(getAggregateId).toHaveBeenCalledWith(validPayload);
    });
  });

  // ─── 10. Kill switch receives correct arguments ────────────────

  describe("kill switch arguments", () => {
    it("passes aggregateType, componentType, commandName, and tenantId to isComponentDisabled", async () => {
      const params = createDefaultParams();

      await processCommand(params);

      expect(mockedIsComponentDisabled).toHaveBeenCalledWith(
        expect.objectContaining({
          aggregateType,
          componentType: "command",
          componentName: commandName,
          tenantId: createTenantId(String(validPayload.tenantId)),
        }),
      );
    });

    it("forwards killSwitchOptions.customKey when provided", async () => {
      const params = createDefaultParams({
        // Test-only: arbitrary string accepted via cast because the
        // FeatureFlagKey constraint lives on production call sites.
        killSwitchOptions: { customKey: "my-custom-key" as any },
      });

      await processCommand(params);

      expect(mockedIsComponentDisabled).toHaveBeenCalledWith(
        expect.objectContaining({
          customKey: "my-custom-key",
        }),
      );
    });
  });
});

// ADR-066 pillar 2 — coalesced same-command batch collapses N appends into one
// storeEvents call. See specs/event-sourcing/producer-append-coalescing.feature.
describe("processCommandBatch", () => {
  const aggregateType: AggregateType = createTestAggregateType();
  const commandType: CommandType = "lw.obs.trace.record_span";
  const commandName = "recordSpan";

  const payloadFor = (n: number): Record<string, unknown> => ({
    tenantId: TEST_CONSTANTS.TENANT_ID_VALUE,
    occurredAt: TEST_CONSTANTS.BASE_TIMESTAMP + n,
    id: `agg-${n}`,
  });

  function makeValidEvent(): Event {
    return createTestEvent({
      aggregateId: TEST_CONSTANTS.AGGREGATE_ID,
      aggregateType,
      tenantId: createTestTenantId(),
      type: TEST_CONSTANTS.EVENT_TYPE_1,
      createdAt: TEST_CONSTANTS.BASE_TIMESTAMP,
    });
  }

  // A valid event carrying an idempotency key derived from its command, so the
  // store call can be asserted to preserve every payload's event and its key.
  function eventWithKey(key: string): Event {
    return { ...makeValidEvent(), idempotencyKey: key };
  }

  // Schema mock that echoes the payload as validated data, so each payload keeps
  // its own tenantId / id through validation (unlike the single-path fixture,
  // which returns one shared payload).
  function createEchoCommandSchema(
    overrides?: Partial<CommandSchema<any, CommandType>>,
  ): CommandSchema<any, CommandType> {
    return {
      type: commandType,
      validate: vi.fn().mockImplementation((p: any) => ({
        success: true,
        data: p,
      })),
      ...overrides,
    };
  }

  function createDefaultBatchParams(
    overrides?: Partial<ProcessCommandBatchParams<Event>>,
  ): ProcessCommandBatchParams<Event> {
    return {
      payloads: [payloadFor(0)],
      commandType,
      commandSchema: createEchoCommandSchema(),
      handler: {
        handle: vi.fn(async (command: any) => [
          eventWithKey(`k-${command.aggregateId}`),
        ]),
      },
      getAggregateId: vi.fn((p: any) => p.id ?? TEST_CONSTANTS.AGGREGATE_ID),
      storeEventsFn: vi.fn().mockResolvedValue(undefined),
      aggregateType,
      commandName,
      pipelineName: "test-pipeline",
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(TEST_CONSTANTS.BASE_TIMESTAMP);
    mockedIsComponentDisabled.mockResolvedValue(false);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("given several same-command payloads across aggregates", () => {
    describe("when the batch is processed", () => {
      /** @scenario 'many items for one aggregate become one insert' */
      /** @scenario 'coalescing preserves every item' */
      it("stores every payload's events in one call with idempotency keys preserved", async () => {
        const storeEventsFn = vi.fn().mockResolvedValue(undefined);
        const params = createDefaultBatchParams({
          payloads: [payloadFor(0), payloadFor(1), payloadFor(2)],
          storeEventsFn,
        });

        await processCommandBatch(params);

        expect(storeEventsFn).toHaveBeenCalledTimes(1);
        const [events, context] = storeEventsFn.mock.calls[0]!;
        expect((events as Event[]).map((e) => e.idempotencyKey)).toEqual([
          "k-agg-0",
          "k-agg-1",
          "k-agg-2",
        ]);
        expect(context).toEqual({
          tenantId: createTenantId(TEST_CONSTANTS.TENANT_ID_VALUE),
        });
      });
    });
  });

  describe("given a payload that fails schema validation", () => {
    describe("when the batch is processed", () => {
      it("throws ValidationError and stores nothing", async () => {
        const storeEventsFn = vi.fn();
        const commandSchema = createEchoCommandSchema({
          validate: vi.fn().mockImplementation((p: any) =>
            p.id === "agg-1"
              ? {
                  success: false,
                  error: {
                    issues: [{ path: ["id"], message: "bad", code: "custom" }],
                  },
                }
              : { success: true, data: p },
          ),
        });
        const params = createDefaultBatchParams({
          payloads: [payloadFor(0), payloadFor(1)],
          commandSchema,
          storeEventsFn,
        });

        await expect(processCommandBatch(params)).rejects.toThrow(
          ValidationError,
        );
        expect(storeEventsFn).not.toHaveBeenCalled();
      });
    });
  });

  describe("given the kill switch disables one payload mid-batch", () => {
    describe("when the batch is processed", () => {
      it("skips the disabled payload and stores the rest", async () => {
        mockedIsComponentDisabled
          .mockResolvedValueOnce(false)
          .mockResolvedValueOnce(true)
          .mockResolvedValueOnce(false);
        const storeEventsFn = vi.fn().mockResolvedValue(undefined);
        const handler = {
          handle: vi.fn(async (command: any) => [
            eventWithKey(`k-${command.aggregateId}`),
          ]),
        };
        const params = createDefaultBatchParams({
          payloads: [payloadFor(0), payloadFor(1), payloadFor(2)],
          handler,
          storeEventsFn,
        });

        await processCommandBatch(params);

        // The disabled payload never reached the handler; the batch continued.
        expect(handler.handle).toHaveBeenCalledTimes(2);
        const [events] = storeEventsFn.mock.calls[0]!;
        expect((events as Event[]).map((e) => e.idempotencyKey)).toEqual([
          "k-agg-0",
          "k-agg-2",
        ]);
      });
    });
  });

  describe("given payloads from two different tenants", () => {
    describe("when the batch is processed", () => {
      it("throws ValidationError before storing", async () => {
        const storeEventsFn = vi.fn();
        const params = createDefaultBatchParams({
          payloads: [
            payloadFor(0),
            { ...payloadFor(1), tenantId: "other-tenant" },
          ],
          storeEventsFn,
        });

        await expect(processCommandBatch(params)).rejects.toThrow(
          /mixes tenants/,
        );
        expect(storeEventsFn).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a handler with post-store cleanup", () => {
    describe("when the batch is stored", () => {
      it("runs cleanup once per handled command", async () => {
        const cleanupAfterStore = vi.fn().mockResolvedValue(undefined);
        const handler = {
          handle: vi.fn(async (command: any) => [
            eventWithKey(`k-${command.aggregateId}`),
          ]),
          cleanupAfterStore,
        };
        const params = createDefaultBatchParams({
          payloads: [payloadFor(0), payloadFor(1)],
          handler,
          storeEventsFn: vi.fn().mockResolvedValue(undefined),
        });

        await processCommandBatch(params);

        expect(cleanupAfterStore).toHaveBeenCalledTimes(2);
      });
    });

    describe("when one command's cleanup rejects", () => {
      /** @contract 'a cleanup failure must never roll back durable events' */
      it("still resolves, stores once, and runs the remaining cleanups", async () => {
        const cleanupAfterStore = vi.fn(async (command: any) => {
          if (command.aggregateId === "agg-1") {
            throw new Error("cleanup boom");
          }
        });
        const handler = {
          handle: vi.fn(async (command: any) => [
            eventWithKey(`k-${command.aggregateId}`),
          ]),
          cleanupAfterStore,
        };
        const storeEventsFn = vi.fn().mockResolvedValue(undefined);
        const params = createDefaultBatchParams({
          payloads: [payloadFor(0), payloadFor(1), payloadFor(2)],
          handler,
          storeEventsFn,
        });

        await expect(processCommandBatch(params)).resolves.toBeUndefined();

        // The durable append happened exactly once, and the failing cleanup
        // neither rolled it back nor stopped the other commands' cleanups.
        expect(storeEventsFn).toHaveBeenCalledTimes(1);
        expect(cleanupAfterStore).toHaveBeenCalledTimes(3);
        expect(
          cleanupAfterStore.mock.calls.map(([command]) => command.aggregateId),
        ).toEqual(["agg-0", "agg-1", "agg-2"]);
      });
    });
  });

  describe("given every handler returns no events", () => {
    describe("when the batch is processed", () => {
      it("skips the store call", async () => {
        const storeEventsFn = vi.fn();
        const params = createDefaultBatchParams({
          payloads: [payloadFor(0), payloadFor(1)],
          handler: { handle: vi.fn().mockResolvedValue([]) },
          storeEventsFn,
        });

        await processCommandBatch(params);

        expect(storeEventsFn).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a handler that throws on one payload", () => {
    describe("when the batch is processed", () => {
      it("fails the whole batch without storing", async () => {
        const storeEventsFn = vi.fn();
        const handler = {
          handle: vi.fn(async (command: any) => {
            if (command.aggregateId === "agg-1") {
              throw new Error("handler boom");
            }
            return [eventWithKey(`k-${command.aggregateId}`)];
          }),
        };
        const params = createDefaultBatchParams({
          payloads: [payloadFor(0), payloadFor(1), payloadFor(2)],
          handler,
          storeEventsFn,
        });

        await expect(processCommandBatch(params)).rejects.toThrow(
          "handler boom",
        );
        expect(storeEventsFn).not.toHaveBeenCalled();
      });
    });
  });

  describe("given an empty payload list", () => {
    describe("when the batch is processed", () => {
      it("does nothing", async () => {
        const storeEventsFn = vi.fn();
        const handler = { handle: vi.fn() };
        const params = createDefaultBatchParams({
          payloads: [],
          handler,
          storeEventsFn,
        });

        await processCommandBatch(params);

        expect(handler.handle).not.toHaveBeenCalled();
        expect(storeEventsFn).not.toHaveBeenCalled();
      });
    });
  });
});
