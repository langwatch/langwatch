/**
 * @vitest-environment node
 * A device code minted over Redis lives as long as the code says.
 * @see specs/ai-gateway/governance/cli-login.feature
 */
import { type RedisConnection, RedisConnectionService } from "@langwatch/redis-client";
import { MemorySharedCredentialStore } from "@langwatch/secrets/shared-credential";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MemoryCliDeviceSettlementChannel } from "../../../channels/memory/memory.cli-device-settlement.channel.ts";
import {
  deviceCodeKey,
  userCodeKey,
} from "../../../features/cli-device/rules/cli-device-session.rules.ts";
import { CliDeviceSessionService } from "../../../features/cli-device/services/cli-device-session.service.ts";
import { RedisCliDeviceSessionRepository } from "../redis.cli-device-session.repository.ts";

const redisUrl = process.env.LANGWATCH_TEST_REDIS_URL;

describe.skipIf(!redisUrl)("device codes over Redis", () => {
  let redis: RedisConnection;
  const written: string[] = [];

  beforeAll(() => {
    redis = new RedisConnectionService().connect({
      url: redisUrl,
      clusterEndpoints: undefined,
      dbIndex: undefined,
    })!;
  });

  afterAll(async () => {
    if (written.length > 0) await redis?.del(...written);
    await redis?.quit();
  });

  describe("when the CLI starts a device code", () => {
    it("stores the code and its user code for 15 minutes", async () => {
      const sessions = CliDeviceSessionService.create({
        store: RedisCliDeviceSessionRepository.create(redis),
        settlements: MemoryCliDeviceSettlementChannel.create(),
        rotations: MemorySharedCredentialStore.create(),
      });

      const record = await sessions.startDeviceCode({ credentialType: "device_session" });
      written.push(deviceCodeKey(record.device_code), userCodeKey(record.user_code));

      expect(record.expires_at - record.created_at).toBe(900_000);
      for (const key of written) {
        const ttl = await redis.ttl(key);
        expect(ttl).toBeGreaterThan(890);
        expect(ttl).toBeLessThanOrEqual(900);
      }
    });
  });
});
