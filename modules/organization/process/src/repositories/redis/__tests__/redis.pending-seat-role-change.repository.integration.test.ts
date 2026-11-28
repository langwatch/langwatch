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
const WEEK_SECONDS = 7 * 24 * 60 * 60;

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
  });

  describe("when a change is saved and its week runs out", () => {
    it("writes every key under the organization's hash tag for a week, then reads nothing", async () => {
      const org = `org-ttl-${namespace}`;
      const saved = { ...change(`${namespace}-change-ttl`, "user-tess"), organizationId: org };
      expect(await pending.save(saved)).toBe(true);
      const keys = await redis.keys(`organization:seat-role-change:{${org}}:*`);

      expect(keys).toHaveLength(4);
      const ttls = await Promise.all(keys.map((key) => redis.ttl(key)));
      expect(ttls.every((ttl) => ttl > SIX_DAYS_SECONDS && ttl <= WEEK_SECONDS)).toBe(true);
      expect(await pending.findById({ organizationId: org, id: saved.id })).toEqual([saved]);

      await Promise.all(keys.map((key) => redis.pexpire(key, 1)));
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(await pending.findById({ organizationId: org, id: saved.id })).toEqual([]);
      expect(await pending.findByPayment({ organizationId: org, payment: saved.payment })).toEqual(
        [],
      );
      expect(
        await pending.findLatestForMember({ organizationId: org, userId: "user-tess" }),
      ).toEqual([]);
      expect(await pending.findWaitingForOrganization({ organizationId: org })).toEqual([]);
    });
  });

  describe("when a claim is released by a caller that no longer holds it", () => {
    it("keeps the current holder's claim", async () => {
      const ref = { organizationId: ORG, id: `${namespace}-change-a` };
      expect(await pending.claim({ ...ref, token: "first" })).toBe(true);
      expect(await pending.claim({ ...ref, token: "second" })).toBe(false);

      await pending.release({ ...ref, token: "second" });
      expect(await pending.renew({ ...ref, token: "first" })).toBe(true);
      expect(await pending.claim({ ...ref, token: "third" })).toBe(false);

      await pending.release({ ...ref, token: "first" });
      expect(await pending.renew({ ...ref, token: "first" })).toBe(false);
      expect(await pending.claim({ ...ref, token: "third" })).toBe(true);
    });
  });

  describe("when the claim holder renews it", () => {
    it("restarts the claim period for that holder only", async () => {
      const ref = { organizationId: ORG, id: `${namespace}-change-renew` };
      const claimKey = `organization:seat-role-change:{${ORG}}:${ref.id}:claim`;
      expect(await pending.claim({ ...ref, token: "holder" })).toBe(true);
      await redis.expire(claimKey, 5);

      expect(await pending.renew({ ...ref, token: "other" })).toBe(false);
      expect(await redis.ttl(claimKey)).toBeLessThanOrEqual(5);
      expect(await pending.renew({ ...ref, token: "holder" })).toBe(true);
      expect(await redis.ttl(claimKey)).toBeGreaterThan(100);
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
