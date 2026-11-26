/**
 * The changes waiting on a seat payment against Redis: one change per payment, written whole or
 * not at all, and a claim only its own holder can free.
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

function change(id: string, userId: string): PendingSeatRoleChangeRecord {
  return {
    id,
    organizationId: ORG,
    userId,
    role: "ADMIN",
    requestedBy: { id: "user-ada", name: null, email: null },
    payment: { kind: "invoice", invoiceId: `in_${namespace}`, seats: 3 },
    url: "https://pay.example",
    status: "waiting",
    reason: null,
    createdAt: 1_000,
  };
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
    const records = ["change-a", "change-b"].map(
      (id) => `organization:seat-role-change:${namespace}-${id}`,
    );
    await redis?.del(...(keys ?? []), ...records, ...records.map((key) => `${key}:claim`));
    await redis?.quit();
  });

  describe("when two changes name the same payment", () => {
    /** @scenario "Another member's seat waits its turn behind the one already waiting" */
    it("saves the first whole and writes nothing of the second", async () => {
      const first = change(`${namespace}-change-a`, "user-sam");
      const second = change(`${namespace}-change-b`, "user-kim");

      expect(await pending.save(first)).toBe(true);
      expect(await pending.save(second)).toBe(false);

      expect(await pending.findByPayment({ payment: first.payment })).toEqual([first]);
      expect(
        await pending.findLatestForMember({ organizationId: ORG, userId: "user-sam" }),
      ).toEqual([first]);
      expect(await pending.findWaitingForOrganization({ organizationId: ORG })).toEqual([first]);
      expect(await pending.findById({ id: second.id })).toEqual([]);
      expect(
        await pending.findLatestForMember({ organizationId: ORG, userId: "user-kim" }),
      ).toEqual([]);
    });
  });

  describe("when a claim is released by a caller that no longer holds it", () => {
    /** @scenario "The return applies the change, then the paid fact changes nothing" */
    it("keeps the current holder's claim", async () => {
      const id = `${namespace}-change-a`;
      expect(await pending.claim({ id, token: "first" })).toBe(true);
      expect(await pending.claim({ id, token: "second" })).toBe(false);

      await pending.release({ id, token: "second" });
      expect(await pending.holds({ id, token: "first" })).toBe(true);
      expect(await pending.claim({ id, token: "third" })).toBe(false);

      await pending.release({ id, token: "first" });
      expect(await pending.holds({ id, token: "first" })).toBe(false);
      expect(await pending.claim({ id, token: "third" })).toBe(true);
    });
  });
});
