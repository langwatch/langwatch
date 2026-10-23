import type { SelfHostedNotice } from "@langwatch/ops-contract";
import { memoryRedisDouble } from "@langwatch/test-harness/client-doubles/redis";
import { describe, expect, it } from "vitest";

import { RedisCloudNoticeRepository } from "../redis.cloud-notice.repository.ts";

const KEY = "ops:usage_report:notices";

const notice: SelfHostedNotice = {
  id: "n1",
  severity: "security",
  title: "Upgrade to 3.4.2",
  body: "",
  url: null,
  fixed_in: "3.4.2",
  published_at: "2026-10-20T09:00:00.000Z",
};

function setup() {
  const redis = memoryRedisDouble();
  return { redis, repository: RedisCloudNoticeRepository.create({ redis }) };
}

describe("RedisCloudNoticeRepository", () => {
  describe("when the notices from a reply are saved", () => {
    it("reads them back and lets them expire within three days", async () => {
      const { redis, repository } = setup();
      await repository.save([notice]);

      expect(await repository.find()).toEqual([notice]);
      const ttl = await redis.ttl(KEY);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(3 * 24 * 60 * 60);
    });

    it("forgets them when a later reply names none", async () => {
      const { redis, repository } = setup();
      await repository.save([notice]);
      await repository.save([]);

      expect(await redis.get(KEY)).toBeNull();
      expect(await repository.find()).toEqual([]);
    });
  });

  describe("given what is held cannot be read", () => {
    it.each([
      ["not JSON", "{oops"],
      ["not a list", JSON.stringify({ id: "n1" })],
    ])("names none when it is %s", async (_, raw) => {
      const { redis, repository } = setup();
      await redis.set(KEY, raw);
      expect(await repository.find()).toEqual([]);
    });

    it("drops a malformed notice and keeps the rest", async () => {
      const { redis, repository } = setup();
      await redis.set(KEY, JSON.stringify([{ id: "bad" }, notice]));
      expect(await repository.find()).toEqual([notice]);
    });
  });
});
