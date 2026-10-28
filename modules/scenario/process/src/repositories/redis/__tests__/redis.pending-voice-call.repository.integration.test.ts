/** @vitest-environment node
 * The pending voice call record against real Redis, through the same contract as the memory twin.
 * @see specs/features/agents/voice-media-claim.feature
 */
import { type RedisConnection, RedisConnectionService } from "@langwatch/redis-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  describePendingVoiceCallRepositoryContract,
  freshPendingVoiceCall,
} from "../../__tests__/pending-voice-call.repository.contract.ts";
import { RedisPendingVoiceCallRepository } from "../redis.pending-voice-call.repository.ts";

const redisUrl = process.env.LANGWATCH_TEST_REDIS_URL;
const LIFETIME_SECONDS = 60;

/** Redis Cluster's CRC16 (XMODEM) over the hash tag, modulo 16384. */
function clusterSlot(key: string): number {
  const open = key.indexOf("{");
  const close = open === -1 ? -1 : key.indexOf("}", open + 1);
  const hashed = open !== -1 && close > open + 1 ? key.slice(open + 1, close) : key;
  let crc = 0;
  for (const byte of Buffer.from(hashed)) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc % 16384;
}

describe.skipIf(!redisUrl)("RedisPendingVoiceCallRepository", () => {
  let connection: RedisConnection;
  let repository: RedisPendingVoiceCallRepository;

  beforeAll(() => {
    connection = new RedisConnectionService().connect({
      url: redisUrl,
      clusterEndpoints: undefined,
      dbIndex: undefined,
    })!;
    repository = RedisPendingVoiceCallRepository.create(connection);
  });

  afterAll(async () => {
    await connection?.quit();
  });

  describePendingVoiceCallRepositoryContract(async () => ({
    repository,
    elapse: (seconds) => new Promise((resolve) => setTimeout(resolve, seconds * 1000)),
  }));

  describe("given a pending call", () => {
    describe("when two claims race", () => {
      /** @scenario "Redis hands a pending call to exactly one of two racing claims" */
      it("hands it to exactly one", async () => {
        const call = freshPendingVoiceCall();
        await repository.put({ call, ttlSeconds: LIFETIME_SECONDS });
        const key = { scenarioRunId: call.scenarioRunId, nonce: call.nonce };

        const claims = await Promise.all([repository.claim(key), repository.claim(key)]);

        expect(claims.filter((claim) => claim.claimed)).toHaveLength(1);
      });
    });

    describe("when its key's remaining time is read", () => {
      /** @scenario "Redis keeps a pending call for its lifetime and no longer" */
      it("is positive and no longer than the lifetime", async () => {
        const call = freshPendingVoiceCall();
        await repository.put({ call, ttlSeconds: LIFETIME_SECONDS });
        const keys = await connection.keys(`*{${call.scenarioRunId}}*`);

        const ttls = await Promise.all(keys.map((key) => connection.ttl(key)));

        expect(ttls.every((ttl) => ttl > 0 && ttl <= LIFETIME_SECONDS)).toBe(true);
      });
    });
  });

  describe("given a run with a pending call, a call SID and a claim", () => {
    async function keysWritten(): Promise<string[]> {
      const call = freshPendingVoiceCall();
      const seen = new Set<string>();
      const snapshot = async () => {
        for (const key of await connection.keys(`*${call.scenarioRunId}*`)) seen.add(key);
      };
      await repository.put({ call, ttlSeconds: LIFETIME_SECONDS });
      await repository.attachCallSid({ scenarioRunId: call.scenarioRunId, callSid: "CA-slot" });
      await snapshot();
      await repository.claim({ scenarioRunId: call.scenarioRunId, nonce: call.nonce });
      await snapshot();
      await repository.cancel({ scenarioRunId: call.scenarioRunId, tombstoneTtlSeconds: 60 });
      await snapshot();
      return [...seen].map((key) => `${key}|${call.scenarioRunId}`);
    }

    describe("when the keys written for the run are listed", () => {
      /** @scenario "Both keys of a run live in one cluster slot" */
      it("lists more than one key, each carrying the run's hash tag and the v1 prefix", async () => {
        const entries = await keysWritten();

        const tagged = entries.filter((entry) => {
          const [key, runId] = entry.split("|") as [string, string];
          return key.includes(`{${runId}}`) && key.includes(":v1:");
        });

        expect(entries.length >= 2 && tagged.length === entries.length).toBe(true);
      });

      /** @scenario "Both keys of a run live in one cluster slot" */
      it("hashes every key to one cluster slot", async () => {
        const entries = await keysWritten();

        const slots = new Set(entries.map((entry) => clusterSlot(entry.split("|")[0]!)));

        expect(slots.size).toBe(1);
      });
    });
  });
});
