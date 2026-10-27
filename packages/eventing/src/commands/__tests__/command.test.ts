import { beforeEach, describe, expect, it } from "vitest";

import { createTenantId } from "../../domain/tenantId.ts";
import { TEST_COMMAND_TYPES } from "../../services/__tests__/testHelpers.ts";
import { createCommand } from "../command.ts";

describe("createCommand", () => {
  let tenantId: ReturnType<typeof createTenantId>;
  let aggregateId: string;
  let commandType: (typeof TEST_COMMAND_TYPES)[number];

  describe("when creating a command with all required fields", () => {
    beforeEach(() => {
      tenantId = createTenantId("tenant-123");
      aggregateId = "aggregate-456";
      commandType = TEST_COMMAND_TYPES[0];
    });

    it("preserves tenantId correctly", () => {
      const payload = { action: "test" };

      const command = createCommand({ tenantId, aggregateId, type: commandType, data: payload });

      expect(command.tenantId).toBe(tenantId);
    });

    it("preserves aggregateId correctly", () => {
      const payload = { action: "test" };

      const command = createCommand({ tenantId, aggregateId, type: commandType, data: payload });

      expect(command.aggregateId).toBe(aggregateId);
    });

    it("preserves command type correctly", () => {
      const payload = { action: "test" };

      const command = createCommand({ tenantId, aggregateId, type: commandType, data: payload });

      expect(command.type).toBe(commandType);
    });

    it("preserves payload data correctly", () => {
      const payload = { action: "test", value: 42 };

      const command = createCommand({ tenantId, aggregateId, type: commandType, data: payload });

      expect(command.data).toEqual(payload);
    });
  });

  describe("when creating a command without metadata", () => {
    it("returns a Command with undefined metadata", () => {
      const tenantId = createTenantId("tenant-123");
      const aggregateId = "aggregate-456";
      const commandType = TEST_COMMAND_TYPES[0];
      const payload = { action: "test" };

      const command = createCommand({ tenantId, aggregateId, type: commandType, data: payload });

      expect(command.metadata).toBeUndefined();
    });
  });

  describe("when creating a command with metadata", () => {
    beforeEach(() => {
      tenantId = createTenantId("tenant-123");
      aggregateId = "aggregate-456";
      commandType = TEST_COMMAND_TYPES[0];
    });

    it("includes metadata when provided", () => {
      const payload = { action: "test" };
      const metadata = { correlationId: "corr-123", traceId: "trace-456" };

      const command = createCommand({
        tenantId,
        aggregateId,
        type: commandType,
        data: payload,
        metadata,
      });

      expect(command.metadata).toEqual(metadata);
    });

    it("preserves complex nested metadata", () => {
      const payload = { action: "test" };
      const metadata = {
        correlationId: "corr-123",
        nested: {
          level1: {
            level2: "deep-value",
          },
        },
        array: [1, 2, 3],
      };

      const command = createCommand({
        tenantId,
        aggregateId,
        type: commandType,
        data: payload,
        metadata,
      });

      expect(command.metadata).toEqual(metadata);
    });
  });

  describe("when working with different payload types", () => {
    beforeEach(() => {
      tenantId = createTenantId("tenant-123");
      aggregateId = "aggregate-456";
      commandType = TEST_COMMAND_TYPES[0];
    });

    it("works with string payload", () => {
      const payload = "string-payload";

      const command = createCommand({ tenantId, aggregateId, type: commandType, data: payload });

      expect(command.data).toBe(payload);
    });

    it("works with number payload", () => {
      const payload = 42;

      const command = createCommand({ tenantId, aggregateId, type: commandType, data: payload });

      expect(command.data).toBe(payload);
    });

    it("works with object payload", () => {
      const payload = { key: "value", number: 123 };

      const command = createCommand({ tenantId, aggregateId, type: commandType, data: payload });

      expect(command.data).toEqual(payload);
    });

    it("works with array payload", () => {
      const payload = [1, 2, 3, "four"];

      const command = createCommand({ tenantId, aggregateId, type: commandType, data: payload });

      expect(command.data).toEqual(payload);
    });

    it("works with null payload", () => {
      const payload = null;

      const command = createCommand({ tenantId, aggregateId, type: commandType, data: payload });

      expect(command.data).toBeNull();
    });
  });

  describe("when working with different metadata types", () => {
    beforeEach(() => {
      tenantId = createTenantId("tenant-123");
      aggregateId = "aggregate-456";
      commandType = TEST_COMMAND_TYPES[0];
    });

    it("works with object metadata", () => {
      const payload = { action: "test" };
      const metadata = { key: "value" };

      const command = createCommand({
        tenantId,
        aggregateId,
        type: commandType,
        data: payload,
        metadata,
      });

      expect(command.metadata).toEqual(metadata);
    });

    it("works with null metadata", () => {
      const payload = { action: "test" };
      const metadata = null;

      const command = createCommand({
        tenantId,
        aggregateId,
        type: commandType,
        data: payload,
        metadata,
      });

      expect(command.metadata).toBeNull();
    });
  });
});
