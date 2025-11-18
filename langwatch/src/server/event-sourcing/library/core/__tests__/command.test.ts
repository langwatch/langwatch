import { describe, it, expect } from "vitest";
import { createCommand, type CommandHandler } from "../command";
import { createTenantId } from "../tenantId";

describe("Command", () => {
  describe("createCommand", () => {
    describe("when metadata is provided", () => {
      it("creates a command with all fields", () => {
        const tenantId = createTenantId("test-tenant");
        const command = createCommand(
          tenantId,
          "agg-1",
          "lw.obs.trace.projection.rebuild",
          { foo: "bar" },
          { meta: 1 },
        );

        expect(command).toEqual({
          tenantId,
          aggregateId: "agg-1",
          type: "lw.obs.trace.projection.rebuild",
          data: { foo: "bar" },
          metadata: { meta: 1 },
        });
      });
    });

    describe("when metadata is omitted", () => {
      it("creates a command without metadata", () => {
        const tenantId = createTenantId("test-tenant");
        const command = createCommand(
          tenantId,
          "agg-1",
          "lw.obs.trace.projection.rebuild",
          {
            foo: "bar",
          },
        );

        expect(command.metadata).toBeUndefined();
        expect(command.tenantId).toBe(tenantId);
      });
    });
  });

  describe("CommandHandler", () => {
    describe("when handle is called", () => {
      it("receives the command", async () => {
        const received: unknown[] = [];

        class TestHandler implements CommandHandler<string> {
          async handle(command: unknown): Promise<void> {
            received.push(command);
          }
        }

        const handler = new TestHandler();
        const tenantId = createTenantId("test-tenant");
        const command = createCommand(
          tenantId,
          "agg-1",
          "lw.obs.trace.projection.rebuild",
          {
            foo: "bar",
          },
        );

        await handler.handle(command);

        expect(received).toHaveLength(1);
      });
    });
  });
});
