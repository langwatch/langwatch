// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * Gateway's key facts delivered twice over the live Redis claims, as two workers would see them.
 * @see enterprise/modules/nurturing/specs/gateway-facts.feature
 */
import { randomUUID } from "node:crypto";

import {
  GATEWAY_BUDGET_CROSSING_EVENT_TYPE,
  GATEWAY_UNBUDGETED_SPEND_EVENT_TYPE,
  GATEWAY_VK_FIRST_REQUEST_EVENT_TYPE,
  GATEWAY_VK_LIFECYCLE_EVENT_TYPE,
} from "@langwatch/gateway-contract";
import { type RedisConnection, RedisConnectionService } from "@langwatch/redis-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { RedisNurturingClaimRepository } from "../../repositories/redis/redis.nurturing-claim.repository.ts";
import {
  crossingFact,
  firstRequestFact,
  gatewayEvent,
  gatewayFactsOver,
  lifecycleFact,
  unbudgetedSpendFact,
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

  describe("when a key's first-request fact is delivered twice", () => {
    /** @scenario "A key's first request delivered twice identifies once over Redis claims" */
    it("identifies the holder with has_app_request once", async () => {
      const facts = await gatewayFactsOver({
        claims: RedisNurturingClaimRepository.create({ redis }),
      });
      await facts.joined("user-holder");
      const firstRequestKeyId = `${virtualKeyId}_first_request`;
      await facts.deliverFact(
        gatewayEvent({
          type: GATEWAY_VK_LIFECYCLE_EVENT_TYPE,
          data: lifecycleFact({ virtual_key_id: firstRequestKeyId }),
        }),
      );
      const firstRequest = gatewayEvent({
        type: GATEWAY_VK_FIRST_REQUEST_EVENT_TYPE,
        data: firstRequestFact({ virtual_key_id: firstRequestKeyId }),
      });
      const beforeFirstRequest = facts.sent.length;

      for (let delivery = 0; delivery < 2; delivery++) await facts.deliverFact(firstRequest);

      expect(facts.sent.slice(beforeFirstRequest)).toEqual([
        {
          type: "identify",
          userId: "user-holder",
          traits: { has_app_request: true, email: "user-holder@example.com" },
        },
      ]);
    });
  });

  describe("when an organization's unbudgeted-spend fact is delivered twice", () => {
    /** @scenario "Unbudgeted spend delivered twice tracks once over Redis claims" */
    it("tracks gateway_spend_without_budget to the admin once", async () => {
      const organizationId = `org-test-${run}`;
      const facts = await gatewayFactsOver({
        claims: RedisNurturingClaimRepository.create({ redis }),
        organizationId,
      });
      const unbudgeted = gatewayEvent({
        type: GATEWAY_UNBUDGETED_SPEND_EVENT_TYPE,
        data: unbudgetedSpendFact({ organization_id: organizationId }),
      });

      for (let delivery = 0; delivery < 2; delivery++) await facts.deliverFact(unbudgeted);

      expect(facts.sent.map((call) => (call.type === "track" ? call.event : call.type))).toEqual([
        "gateway_spend_without_budget",
      ]);
    });
  });
});
