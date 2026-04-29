import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/utils/logger/server", () => ({
  createLogger: () => ({
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import type { trackServerEvent } from "../../posthog";
import {
  recordActiveUser,
  type RecordActiveUserDeps,
} from "../recordActiveUser";

type RedisLike = NonNullable<RecordActiveUserDeps["redis"]>;

function makeRedis(setImpl: () => Promise<unknown>) {
  const set = vi.fn().mockImplementation(setImpl);
  return { set, instance: { set } as unknown as RedisLike };
}

const FROZEN_NOW = () => new Date("2026-04-29T10:00:00Z");

describe("recordActiveUser", () => {
  let trackEvent: ReturnType<typeof vi.fn> & typeof trackServerEvent;

  beforeEach(() => {
    trackEvent = vi.fn() as ReturnType<typeof vi.fn> & typeof trackServerEvent;
  });

  describe("when Redis confirms the call is the first today", () => {
    it("fires api_active_user with userId as distinctId, source, and version", async () => {
      const { instance: redis } = makeRedis(async () => "OK");

      await recordActiveUser(
        { userId: "u1", source: "mcp", version: "0.42.1" },
        { redis, trackEvent, now: FROZEN_NOW },
      );

      expect(trackEvent).toHaveBeenCalledTimes(1);
      expect(trackEvent).toHaveBeenCalledWith({
        userId: "u1",
        event: "api_active_user",
        properties: { source: "mcp", version: "0.42.1" },
      });
    });

    it("uses an active_user key keyed by userId, UTC day, and source with a 48h TTL", async () => {
      const { set, instance: redis } = makeRedis(async () => "OK");

      await recordActiveUser(
        { userId: "u1", source: "mcp" },
        { redis, trackEvent, now: FROZEN_NOW },
      );

      expect(set).toHaveBeenCalledWith(
        "active_user:u1:2026-04-29:mcp",
        "1",
        "EX",
        172800,
        "NX",
      );
    });

    it("omits version from properties when not provided", async () => {
      const { instance: redis } = makeRedis(async () => "OK");

      await recordActiveUser(
        { userId: "u1", source: "unknown" },
        { redis, trackEvent, now: FROZEN_NOW },
      );

      expect(trackEvent).toHaveBeenCalledWith({
        userId: "u1",
        event: "api_active_user",
        properties: { source: "unknown" },
      });
    });
  });

  describe("when Redis indicates the heartbeat already exists for today", () => {
    it("does not fire api_active_user", async () => {
      const { instance: redis } = makeRedis(async () => null);

      await recordActiveUser(
        { userId: "u1", source: "mcp" },
        { redis, trackEvent, now: FROZEN_NOW },
      );

      expect(trackEvent).not.toHaveBeenCalled();
    });
  });

  describe("when Redis throws", () => {
    it("fires api_active_user anyway as a graceful overcount", async () => {
      const { instance: redis } = makeRedis(async () => {
        throw new Error("redis down");
      });

      await recordActiveUser(
        { userId: "u1", source: "mcp" },
        { redis, trackEvent, now: FROZEN_NOW },
      );

      expect(trackEvent).toHaveBeenCalledTimes(1);
    });

    it("never throws to the caller", async () => {
      const { instance: redis } = makeRedis(async () => {
        throw new Error("redis down");
      });

      await expect(
        recordActiveUser(
          { userId: "u1", source: "mcp" },
          { redis, trackEvent, now: FROZEN_NOW },
        ),
      ).resolves.toBeUndefined();
    });
  });

  describe("when redis is not configured", () => {
    it("fires api_active_user without dedup", async () => {
      await recordActiveUser(
        { userId: "u1", source: "mcp" },
        { redis: undefined, trackEvent, now: FROZEN_NOW },
      );

      expect(trackEvent).toHaveBeenCalledTimes(1);
    });
  });
});
