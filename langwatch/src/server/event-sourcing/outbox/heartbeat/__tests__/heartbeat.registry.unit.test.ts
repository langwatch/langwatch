import { describe, expect, it } from "vitest";
import type { OutboxEnqueueRequest } from "../../outboxReactor.types";
import { OutboxHeartbeatRegistry } from "../heartbeat.registry";
import type { HeartbeatDefinition } from "../heartbeat.types";

function makeHeartbeat(
  overrides: Partial<HeartbeatDefinition> = {},
): HeartbeatDefinition {
  return {
    name: "test-heartbeat",
    intervalMs: 1_000,
    async decide(): Promise<OutboxEnqueueRequest[]> {
      return [];
    },
    ...overrides,
  };
}

describe("OutboxHeartbeatRegistry", () => {
  describe("given an empty registry", () => {
    describe("when register is called once", () => {
      it("includes the heartbeat in getAll", () => {
        const registry = new OutboxHeartbeatRegistry();
        const heartbeat = makeHeartbeat();

        registry.register(heartbeat);

        expect(registry.getAll()).toEqual([heartbeat]);
      });
    });

    describe("when register is called with several distinct names", () => {
      it("returns all of them from getAll in insertion order", () => {
        const registry = new OutboxHeartbeatRegistry();
        const a = makeHeartbeat({ name: "a" });
        const b = makeHeartbeat({ name: "b" });

        registry.register(a);
        registry.register(b);

        expect(registry.getAll()).toEqual([a, b]);
      });
    });
  });

  describe("given a registry with a heartbeat already registered", () => {
    describe("when register is called again with the same name", () => {
      it("throws a descriptive error", () => {
        const registry = new OutboxHeartbeatRegistry();
        registry.register(makeHeartbeat({ name: "dup" }));

        expect(() => registry.register(makeHeartbeat({ name: "dup" }))).toThrow(
          /heartbeat "dup" is already registered/,
        );
      });
    });
  });
});
