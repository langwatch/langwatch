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
import { processCommand } from "../commandDispatcher";
import type { ProcessCommandParams } from "../commandDispatcher";

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
    return createTestEvent(
      overrides?.aggregateId ?? TEST_CONSTANTS.AGGREGATE_ID,
      overrides?.aggregateType ?? aggregateType,
      overrides?.tenantId ?? tenantId,
      overrides?.type ?? TEST_CONSTANTS.EVENT_TYPE_1,
      overrides?.createdAt ?? TEST_CONSTANTS.BASE_TIMESTAMP,
    );
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

  function createMockHandler(
    events?: Event[],
  ): CommandHandler<any, Event> {
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
      await expect(processCommand(params)).rejects.toThrow(
        /non-array value/,
      );
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
      expect(storeEventsFn).toHaveBeenCalledWith(
        expect.any(Array),
        { tenantId: expectedTenantId },
      );
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
        killSwitchOptions: { customKey: "my-custom-key" },
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
