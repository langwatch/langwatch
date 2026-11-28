/**
 * The seat payment an approval waits on, against Redis: kept per opening, read back whole, never
 * found for another opening of the same request, and kept a week.
 * @vitest-environment node
 * @see modules/organization/specs/seat-requests.feature
 */
import { type RedisConnection, RedisConnectionService } from "@langwatch/redis-client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { RedisSeatApprovalPaymentRepository } from "../redis.seat-approval-payment.repository.ts";

const redisUrl = process.env.LANGWATCH_TEST_REDIS_URL;
const namespace = nanoid(8);
const ORG = `org-${namespace}`;
const SIX_DAYS_SECONDS = 6 * 24 * 60 * 60;
const WEEK_SECONDS = 7 * 24 * 60 * 60;
const INVOICE = { kind: "invoice", invoiceId: `in_${namespace}`, seats: 3 } as const;

describe.skipIf(!redisUrl)("the seat approval payments over Redis", () => {
  let redis: RedisConnection;
  let payments: RedisSeatApprovalPaymentRepository;

  beforeAll(() => {
    redis = new RedisConnectionService().connect({
      url: redisUrl,
      clusterEndpoints: undefined,
      dbIndex: undefined,
    })!;
    payments = RedisSeatApprovalPaymentRepository.create(redis);
  });

  afterAll(async () => {
    const keys = await redis?.keys(`organization:seat-approval-payment:*${namespace}*`);
    if (keys?.length) await redis.del(...keys);
    await redis?.quit();
  });

  /** @scenario "Completing an approval settles only the payment that approval recorded" */
  it("finds the payment only for the opening it was kept for, for a week", async () => {
    const opening = { organizationId: ORG, seatRequestId: "sr-lena", openedAt: 1_000 };

    await payments.save({ ...opening, payment: INVOICE });

    expect(await payments.find(opening)).toEqual([INVOICE]);
    expect(await payments.find({ ...opening, openedAt: 2_000 })).toEqual([]);
    expect(await payments.find({ ...opening, organizationId: `other-${namespace}` })).toEqual([]);
    const [key] = await redis.keys(`organization:seat-approval-payment:{${ORG}}:*`);
    const ttl = await redis.ttl(key!);
    expect(ttl).toBeGreaterThan(SIX_DAYS_SECONDS);
    expect(ttl).toBeLessThanOrEqual(WEEK_SECONDS);
  });
});
