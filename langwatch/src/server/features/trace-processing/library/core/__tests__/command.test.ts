import { describe, it, expect } from "vitest";
import { createCommand, type CommandHandler } from "../command";

describe("Command", () => {
  describe("createCommand", () => {
    describe("when metadata is provided", () => {
      it("creates a command with all fields", () => {
        const command = createCommand(
          "agg-1",
          "do_something",
          { foo: "bar" },
          { meta: 1 },
        );

        expect(command).toEqual({
          aggregateId: "agg-1",
          type: "do_something",
          data: { foo: "bar" },
          metadata: { meta: 1 },
        });
      });
    });

    describe("when metadata is omitted", () => {
      it("creates a command without metadata", () => {
        const command = createCommand("agg-1", "do_something", { foo: "bar" });

        expect(command.metadata).toBeUndefined();
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
        const command = createCommand("agg-1", "do_something", { foo: "bar" });

        await handler.handle(command);

        expect(received).toHaveLength(1);
      });
    });
  });
});
