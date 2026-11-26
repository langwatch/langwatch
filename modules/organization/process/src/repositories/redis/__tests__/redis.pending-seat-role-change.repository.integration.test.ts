/**
 * The changes waiting on a seat payment against Redis: one change per payment, written whole or
 * not at all, every key in its organization's Cluster slot, a claim only its own holder can free,
 * and a settled change never settled again.
 * @vitest-environment node
 * @see specs/licensing/role-change-seat.feature
 */
import { type RedisConnection, RedisConnectionService } from "@langwatch/redis-client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PendingSeatRoleChangeRecord } from "../../pending-seat-role-change.repository.ts";
import { RedisPendingSeatRoleChangeRepository } from "../redis.pending-seat-role-change.repository.ts";

const redisUrl = process.env.LANGWATCH_TEST_REDIS_URL;
const namespace = nanoid(8);
const ORG = `org-${namespace}`;
const SIX_DAYS_SECONDS = 6 * 24 * 60 * 60;

function change(id: string, userId: string, invoiceId = `in_${namespace}`) {
  return {
    id,
    organizationId: ORG,
    userId,
    role: "ADMIN",
    requestedBy: { id: "user-ada", name: null, email: null },
    payment: { kind: "invoice", invoiceId, seats: 3 },
    url: "https://pay.example",
    status: "waiting",
    reason: null,
    createdAt: 1_000,
  } satisfies PendingSeatRoleChangeRecord;
}

describe.skipIf(!redisUrl)("the pending seat role changes over Redis", () => {
  let redis: RedisConnection;
  let pending: RedisPendingSeatRoleChangeRepository;

  beforeAll(() => {
    redis = new RedisConnectionService().connect({
      url: redisUrl,
      clusterEndpoints: undefined,
      dbIndex: undefined,
    })!;
    pending = RedisPendingSeatRoleChangeRepository.create(redis);
  });

  afterAll(async () => {
    const keys = await redis?.keys(`organization:seat-role-change:*${namespace}*`);
    if (keys?.length) await redis.del(...keys);
    await redis?.quit();
  });

  describe("when two changes name the same payment", () => {
    it("saves the first whole and writes nothing of the second", async () => {
      const first = change(`${namespace}-change-a`, "user-sam");
      const second = change(`${namespace}-change-b`, "user-kim");

      expect(await pending.save(first)).toBe(true);
      expect(await pending.save(second)).toBe(false);

      expect(await pending.findByPayment({ organizationId: ORG, payment: first.payment })).toEqual([
        first,
      ]);
      expect(
        await pending.findLatestForMember({ organizationId: ORG, userId: "user-sam" }),
      ).toEqual([first]);
      expect(await pending.findWaitingForOrganization({ organizationId: ORG })).toEqual([first]);
      expect(await pending.findById({ organizationId: ORG, id: second.id })).toEqual([]);
      expect(
        await pending.findLatestForMember({ organizationId: ORG, userId: "user-kim" }),
      ).toEqual([]);
    });

    it("writes every key under the organization's hash tag, kept for a week", async () => {
      const keys = await redis.keys(`organization:seat-role-change:*${namespace}*`);

      expect(keys.length).toBeGreaterThanOrEqual(4);
      expect(keys.every((key) => key.includes(`{${ORG}}`))).toBe(true);
      const ttls = await Promise.all(keys.map((key) => redis.ttl(key)));
      expect(ttls.every((ttl) => ttl > SIX_DAYS_SECONDS)).toBe(true);
    });
  });

  describe("when a claim is released by a caller that no longer holds it", () => {
    it("keeps the current holder's claim", async () => {
      const ref = { organizationId: ORG, id: `${namespace}-change-a` };
      expect(await pending.claim({ ...ref, token: "first" })).toBe(true);
      expect(await pending.claim({ ...ref, token: "second" })).toBe(false);

      await pending.release({ ...ref, token: "second" });
      expect(await pending.holds({ ...ref, token: "first" })).toBe(true);
      expect(await pending.claim({ ...ref, token: "third" })).toBe(false);

      await pending.release({ ...ref, token: "first" });
      expect(await pending.holds({ ...ref, token: "first" })).toBe(false);
      expect(await pending.claim({ ...ref, token: "third" })).toBe(true);
    });
  });

  describe("when a settled change is settled again", () => {
    it("keeps the first outcome and answers false", async () => {
      const saved = change(`${namespace}-change-c`, "user-lea", `in_${namespace}_c`);
      await pending.save(saved);
      const ref = { organizationId: ORG, id: saved.id };

      expect(await pending.settle({ ...ref, status: "applied" })).toBe(true);
      expect(await pending.settle({ ...ref, status: "seat_only", reason: "stale" })).toBe(false);
      expect(await pending.findById(ref)).toEqual([{ ...saved, status: "applied", reason: null }]);
    });
  });
});
