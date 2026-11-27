import { memoryRedisDouble, memoryRedisStore } from "@langwatch/test-harness/client-doubles/redis";
import { describe, expect, it } from "vitest";

import { LWQL_ACCESS_MODEL_ANSWER_TTL_MS } from "../../langwatch-ql-access-model-answer.repository.ts";
import { RedisLangWatchQLAccessModelAnswerRepository } from "../redis.langwatch-ql-access-model-answer.repository.ts";

const ORIGIN = "http://clickhouse.shared.invalid:8123";
const OTHER_ORIGIN = "http://clickhouse.other.invalid:8123";
const KEY = `lwql:access-model-answer:${ORIGIN}`;

function answers() {
  const store = memoryRedisStore();
  const redis = memoryRedisDouble({ store });
  return { store, repository: RedisLangWatchQLAccessModelAnswerRepository.create({ redis }) };
}

describe("RedisLangWatchQLAccessModelAnswerRepository", () => {
  describe("given no answer recorded", () => {
    it("finds none", async () => {
      const { repository } = answers();

      expect(await repository.findAnswer({ origin: ORIGIN })).toBeNull();
    });
  });

  describe("given an answer recorded for one server", () => {
    it("finds it under that server's key, kept for five minutes so Redis expires it", async () => {
      const { store, repository } = answers();

      await repository.recordAnswer({ origin: ORIGIN, answer: "not_provisioned" });

      expect(await repository.findAnswer({ origin: ORIGIN })).toBe("not_provisioned");
      expect(store.expiries.get(KEY)).toBe(LWQL_ACCESS_MODEL_ANSWER_TTL_MS);
      expect(LWQL_ACCESS_MODEL_ANSWER_TTL_MS).toBe(5 * 60_000);
    });

    it("never answers for another server", async () => {
      const { repository } = answers();

      await repository.recordAnswer({ origin: ORIGIN, answer: "provisioned" });

      expect(await repository.findAnswer({ origin: OTHER_ORIGIN })).toBeNull();
    });
  });

  describe("given a value the gate never writes under the key", () => {
    it("finds no answer rather than guessing one", async () => {
      const { store, repository } = answers();
      store.strings.set(KEY, "yes");

      expect(await repository.findAnswer({ origin: ORIGIN })).toBeNull();
    });
  });
});
