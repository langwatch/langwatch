import { memoryRedisDouble } from "@langwatch/test-harness/client-doubles/redis";
import { describe, expect, it } from "vitest";

import type { McpSessionRelayRepository } from "../mcp-session-relay.repository.ts";
import { MemoryMcpSessionRelayRepository } from "../memory/memory.mcp-session-relay.repository.ts";
import { RedisMcpSessionRelayRepository } from "../redis/redis.mcp-session-relay.repository.ts";

const TIERS: readonly [string, () => McpSessionRelayRepository][] = [
  ["redis", () => RedisMcpSessionRelayRepository.create({ redis: memoryRedisDouble() })],
  ["memory", () => MemoryMcpSessionRelayRepository.create()],
];

/** Resolves with the first message the session hears. */
function firstMessage(relay: McpSessionRelayRepository, sessionId: string): Promise<string> {
  return new Promise((resolve) => {
    void relay.listen({ sessionId, onMessage: resolve });
  });
}

describe.each(TIERS)("the %s MCP session relay", (_tier, build) => {
  describe("given a replica listening for a session", () => {
    it("hands a published message to it and counts one receiver", async () => {
      const relay = build();
      const heard = firstMessage(relay, "session-1");
      await Promise.resolve();

      const receivers = await relay.publish({ sessionId: "session-1", message: '{"id":1}' });

      expect(receivers).toBe(1);
      await expect(heard).resolves.toBe('{"id":1}');
      relay.close();
    });
  });

  describe("given nobody listening for the session", () => {
    it("counts no receivers, so the caller clears the stale record", async () => {
      const relay = build();

      await expect(relay.publish({ sessionId: "session-1", message: "{}" })).resolves.toBe(0);
      relay.close();
    });
  });

  describe("given a listener that stopped listening", () => {
    it("counts no receivers", async () => {
      const relay = build();
      await relay.listen({ sessionId: "session-1", onMessage: () => undefined });
      await relay.stopListening({ sessionId: "session-1" });

      await expect(relay.publish({ sessionId: "session-1", message: "{}" })).resolves.toBe(0);
      relay.close();
    });
  });
});

describe("the redis MCP session relay with no Redis configured", () => {
  it("listens to nothing and reaches nobody", async () => {
    const relay = RedisMcpSessionRelayRepository.create({ redis: null });
    await relay.listen({ sessionId: "session-1", onMessage: () => undefined });

    await expect(relay.publish({ sessionId: "session-1", message: "{}" })).resolves.toBe(0);
  });
});
