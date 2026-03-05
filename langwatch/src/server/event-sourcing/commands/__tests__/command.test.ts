import { describe, expect, it } from "vitest";

import { COMMAND_TYPES } from "../../domain/commandType";
import { createTenantId } from "../../domain/tenantId";
import { createCommand } from "../command";

describe("createCommand", () => {
  describe("when creating a command with all required fields", () => {
    it("preserves tenantId correctly", () => {
      const tenantId = createTenantId("tenant-123");
      const aggregateId = "aggregate-456";
      const commandType = COMMAND_TYPES[0];
      const payload = { action: "test" };

      const command = createCommand(
        tenantId,
        aggregateId,
        commandType,
        payload,
      );

      expect(command.tenantId).toBe(tenantId);
    });

    it("preserves aggregateId correctly", () => {
      const tenantId = createTenantId("tenant-123");
      const aggregateId = "aggregate-456";
      const commandType = COMMAND_TYPES[0];
      const payload = { action: "test" };

      const command = createCommand(
        tenantId,
        aggregateId,
        commandType,
        payload,
      );

      expect(command.aggregateId).toBe(aggregateId);
    });

    it("preserves command type correctly", () => {
      const tenantId = createTenantId("tenant-123");
      const aggregateId = "aggregate-456";
      const commandType = COMMAND_TYPES[0];
      const payload = { action: "test" };

      const command = createCommand(
        tenantId,
        aggregateId,
        commandType,
        payload,
      );

      expect(command.type).toBe(commandType);
    });

    it("preserves payload data correctly", () => {
      const tenantId = createTenantId("tenant-123");
      const aggregateId = "aggregate-456";
      const commandType = COMMAND_TYPES[0];
      const payload = { action: "test", value: 42 };

      const command = createCommand(
        tenantId,
        aggregateId,
        commandType,
        payload,
      );

      expect(command.data).toEqual(payload);
    });
  });

  describe("when creating a command without metadata", () => {
    it("returns a Command with undefined metadata", () => {
      const tenantId = createTenantId("tenant-123");
      const aggregateId = "aggregate-456";
      const commandType = COMMAND_TYPES[0];
      const payload = { action: "test" };

      const command = createCommand(
        tenantId,
        aggregateId,
        commandType,
        payload,
      );

      expect(command.metadata).toBeUndefined();
    });
  });

  describe("when creating a command with metadata", () => {
    it("includes metadata when provided", () => {
      const tenantId = createTenantId("tenant-123");
      const aggregateId = "aggregate-456";
      const commandType = COMMAND_TYPES[0];
      const payload = { action: "test" };
      const metadata = { correlationId: "corr-123", traceId: "trace-456" };

      const command = createCommand(
        tenantId,
        aggregateId,
        commandType,
        payload,
        metadata,
      );

      expect(command.metadata).toEqual(metadata);
    });

    it("preserves complex nested metadata", () => {
      const tenantId = createTenantId("tenant-123");
      const aggregateId = "aggregate-456";
      const commandType = COMMAND_TYPES[0];
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

      const command = createCommand(
        tenantId,
        aggregateId,
        commandType,
        payload,
        metadata,
      );

      expect(command.metadata).toEqual(metadata);
    });
  });

  describe("when working with different payload types", () => {
    it("works with string payload", () => {
      const tenantId = createTenantId("tenant-123");
      const aggregateId = "aggregate-456";
      const commandType = COMMAND_TYPES[0];
      const payload = "string-payload";

      const command = createCommand(
        tenantId,
        aggregateId,
        commandType,
        payload,
      );

      expect(command.data).toBe(payload);
    });

    it("works with number payload", () => {
      const tenantId = createTenantId("tenant-123");
      const aggregateId = "aggregate-456";
      const commandType = COMMAND_TYPES[0];
      const payload = 42;

      const command = createCommand(
        tenantId,
        aggregateId,
        commandType,
        payload,
      );

      expect(command.data).toBe(payload);
    });

    it("works with object payload", () => {
      const tenantId = createTenantId("tenant-123");
      const aggregateId = "aggregate-456";
      const commandType = COMMAND_TYPES[0];
      const payload = { key: "value", number: 123 };

      const command = createCommand(
        tenantId,
        aggregateId,
        commandType,
        payload,
      );

      expect(command.data).toEqual(payload);
    });

    it("works with array payload", () => {
      const tenantId = createTenantId("tenant-123");
      const aggregateId = "aggregate-456";
      const commandType = COMMAND_TYPES[0];
      const payload = [1, 2, 3, "four"];

      const command = createCommand(
        tenantId,
        aggregateId,
        commandType,
        payload,
      );

      expect(command.data).toEqual(payload);
    });

    it("works with null payload", () => {
      const tenantId = createTenantId("tenant-123");
      const aggregateId = "aggregate-456";
      const commandType = COMMAND_TYPES[0];
      const payload = null;

      const command = createCommand(
        tenantId,
        aggregateId,
        commandType,
        payload,
      );

      expect(command.data).toBeNull();
    });
  });

  describe("when working with different metadata types", () => {
    it("works with object metadata", () => {
      const tenantId = createTenantId("tenant-123");
      const aggregateId = "aggregate-456";
      const commandType = COMMAND_TYPES[0];
      const payload = { action: "test" };
      const metadata = { key: "value" };

      const command = createCommand(
        tenantId,
        aggregateId,
        commandType,
        payload,
        metadata,
      );

      expect(command.metadata).toEqual(metadata);
    });

    it("works with null metadata", () => {
      const tenantId = createTenantId("tenant-123");
      const aggregateId = "aggregate-456";
      const commandType = COMMAND_TYPES[0];
      const payload = { action: "test" };
      const metadata = null;

      const command = createCommand(
        tenantId,
        aggregateId,
        commandType,
        payload,
        metadata,
      );

      expect(command.metadata).toBeNull();
    });
  });

  describe("when working with different command types", () => {
    it.todo("preserves different command types correctly");
  });
});
