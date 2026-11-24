// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * Gateway's fact that an organization's person keys spent without a budget, through nurturing's
 * own lanes and copies, to the requests a recording Customer.io received.
 * @see enterprise/modules/nurturing/specs/gateway-facts.feature
 */
import {
  GATEWAY_UNBUDGETED_SPEND_EVENT_TYPE,
  type RecordUnbudgetedSpendCommandData,
} from "@langwatch/gateway-contract";
import { describe, expect, it } from "vitest";

import {
  ADMIN_USER_ID,
  gatewayEvent,
  gatewayFactsOver,
  ORGANIZATION_ID,
  unbudgetedSpendFact,
} from "./nurturing-gateway-facts.test-helpers.ts";

const unbudgeted = (overrides: Partial<RecordUnbudgetedSpendCommandData> = {}) =>
  gatewayEvent({
    type: GATEWAY_UNBUDGETED_SPEND_EVENT_TYPE,
    data: unbudgetedSpendFact(overrides),
  });

describe("an organization's spend without a budget in nurturing", () => {
  describe("when gateway records a week of unbudgeted spend", () => {
    /** @scenario "Unbudgeted spend sends gateway_spend_without_budget to the organization's admin" */
    it("tracks one gateway_spend_without_budget to the admin with the template's payload", async () => {
      const facts = await gatewayFactsOver();

      await facts.deliverFact(unbudgeted());

      expect(facts.sent).toEqual([
        {
          type: "track",
          userId: ADMIN_USER_ID,
          event: "gateway_spend_without_budget",
          properties: {
            keys: [
              { name: "Support bot key", spend: 42.5 },
              { name: "CI key", spend: 7 },
            ],
            key_count: 2,
            total_spend: 49.5,
            organization_id: ORGANIZATION_ID,
          },
          messageId: `${ORGANIZATION_ID}:unbudgeted:2026-W48`,
        },
      ]);
      expect(facts.requests.join("")).not.toContain("vk_");
    });
  });

  describe("when the organization's copied admin is no current member", () => {
    /** @scenario "Unbudgeted spend with no admin to tell sends nothing" */
    it("sends nothing and logs the dropped fact at debug level", async () => {
      const facts = await gatewayFactsOver();
      await facts.disabled(ADMIN_USER_ID);

      await facts.deliverFact(unbudgeted());

      expect(facts.sent).toEqual([]);
      expect(facts.logLines.findLine("debug", "no current member to tell")).toBeDefined();
    });
  });

  describe("when the organization has no copied admin", () => {
    /** @scenario "Unbudgeted spend with no admin to tell sends nothing" */
    it("sends nothing", async () => {
      const facts = await gatewayFactsOver();

      await facts.deliverFact(unbudgeted({ organization_id: "org-without-admin" }));

      expect(facts.sent).toEqual([]);
    });
  });

  describe("when the same week's fact is delivered twice", () => {
    /** @scenario "Unbudgeted spend delivered twice tracks once" */
    it("tracks once, and a new week tracks again", async () => {
      const facts = await gatewayFactsOver();

      for (let delivery = 0; delivery < 2; delivery++) await facts.deliverFact(unbudgeted());
      await facts.deliverFact(unbudgeted({ iso_week: "2026-W49", occurred_at: 7_000 }));

      expect(facts.sent.map((call) => (call.type === "track" ? call.event : call.type))).toEqual([
        "gateway_spend_without_budget",
        "gateway_spend_without_budget",
      ]);
    });
  });

  describe("when Customer.io refuses the track once", () => {
    it("fails the delivery, and its retry sends the track once", async () => {
      const facts = await gatewayFactsOver();
      facts.refusing.add("track");

      await expect(facts.deliverFact(unbudgeted())).rejects.toThrow(
        "Customer.io /batch failed: HTTP 500",
      );
      facts.refusing.clear();
      await facts.deliverFact(unbudgeted());

      expect(facts.sent).toHaveLength(1);
    });
  });
});
