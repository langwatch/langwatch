// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * Gateway's key facts delivered twice over the live Redis claims, as two workers would see them.
 * @see enterprise/modules/nurturing/specs/gateway-facts.feature
 */
import { randomUUID } from "node:crypto";

import {
  GATEWAY_BUDGET_CROSSING_EVENT_TYPE,
  GATEWAY_VK_LIFECYCLE_EVENT_TYPE,
} from "@langwatch/gateway-contract";
import { type RedisConnection, RedisConnectionService } from "@langwatch/redis-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { RedisNurturingClaimRepository } from "../../repositories/redis/redis.nurturing-claim.repository.ts";
import {
  crossingFact,
  gatewayEvent,
  gatewayFactsOver,
  lifecycleFact,
} from "./nurturing-gateway-facts.test-helpers.ts";

const redisUrl = process.env.LANGWATCH_TEST_REDIS_URL;
const run = randomUUID();
const virtualKeyId = `vk_test_${run}`;
const budgetId = `budget-test-${run}`;

describe.skipIf(!redisUrl)("gateway's key facts over Redis claims", () => {
  let redis: RedisConnection;

  beforeAll(() => {
    redis = new RedisConnectionService().connect({
      url: redisUrl,
      clusterEndpoints: undefined,
      dbIndex: undefined,
    })!;
  });

  afterAll(async () => {
    const keys = await redis?.keys(`member:idempotency:nurturing:*${run}*`);
    if (keys && keys.length > 0) await redis.del(...keys);
    await redis?.quit();
  });

  describe("when a created key's fact and a crossing are each delivered twice", () => {
    /** @scenario "The same fact delivered twice sends each call once over Redis claims" */
    it("sends one identify and one track for the creation, and one track for the crossing", async () => {
      const facts = await gatewayFactsOver({
        claims: RedisNurturingClaimRepository.create({ redis }),
      });
      await facts.joined("user-holder");
      const created = gatewayEvent({
        type: GATEWAY_VK_LIFECYCLE_EVENT_TYPE,
        data: lifecycleFact({ virtual_key_id: virtualKeyId }),
      });
      const crossed = gatewayEvent({
        type: GATEWAY_BUDGET_CROSSING_EVENT_TYPE,
        data: crossingFact({ virtual_key_id: virtualKeyId, budget_id: budgetId }),
      });

      for (let delivery = 0; delivery < 2; delivery++) await facts.deliverFact(created);
      for (let delivery = 0; delivery < 2; delivery++) await facts.deliverFact(crossed);

      const calls = facts.sent.map((call) => [
        call.type,
        call.type === "track" ? call.event : null,
      ]);
      expect(calls).toEqual([
        ["identify", null],
        ["track", "virtual_key_created"],
        ["track", "key_budget_threshold"],
      ]);
    });
  });
});
