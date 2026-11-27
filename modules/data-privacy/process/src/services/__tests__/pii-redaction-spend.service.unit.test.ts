import type { PiiRedactionSpendPricedEventData } from "@langwatch/data-privacy-contract/pii-redaction-spend";
import { describe, expect, it } from "vitest";

import { piiRedactionRequestIdKey } from "../../rules/pii-redaction-spend.rules.ts";
import { PiiRedactionSpendService } from "../pii-redaction-spend.service.ts";

const ORGANIZATION_ID = "org_1";
const PROJECT_ID = "project_1";
const NOW = 1_700_000_000_000;

/** The recorder takes no flag reader: a call is priced as its routing decided (ADR-201). */
function setup({
  dispatchFails = false,
  noKey = false,
}: {
  dispatchFails?: boolean;
  noKey?: boolean;
} = {}) {
  const facts: PiiRedactionSpendPricedEventData[] = [];
  const errors: { fields: Record<string, unknown>; message: string }[] = [];
  const spend = PiiRedactionSpendService.create({
    requestIdKey: noKey ? undefined : piiRedactionRequestIdKey("test-key-pepper"),
    recordSpendPriced: async (fact) => {
      if (dispatchFails) throw new Error("queue unreachable");
      facts.push(fact);
    },
    log: { error: (fields, message) => errors.push({ fields, message }) },
    now: () => NOW,
  });
  return { spend, facts, errors };
}

const call = {
  organizationId: ORGANIZATION_ID,
  projectId: PROJECT_ID,
  texts: ["a".repeat(1_000)],
  recordKey: "trace-1:span-1",
  callDurationsMs: [1_000],
  priced: true,
};

describe("PiiRedactionSpendService", () => {
  describe("when it was built with no request-id key", () => {
    it("records nothing and logs the unbilled call at error", async () => {
      const { spend, facts, errors } = setup({ noKey: true });

      await spend.record(call);

      expect(facts).toEqual([]);
      expect(errors).toEqual([
        {
          fields: { organizationId: ORGANIZATION_ID, projectId: PROJECT_ID, priceNanoUsd: 500_000 },
          message:
            "PII redaction model call not billed: no key pepper to derive its request id from",
        },
      ]);
    });
  });

  describe("when the model answers a priced batch of 1,000 characters", () => {
    /** @scenario "An answered batch is priced at the published rate per character" */
    it("records one priced fact at 500,000 nano dollars with our cost beside it", async () => {
      const { spend, facts } = setup();

      await spend.record(call);

      expect(facts).toHaveLength(1);
      expect(facts[0]).toMatchObject({
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
        characters: 1_000,
        texts: 1,
        priceNanoUsd: 500_000,
        costNanoUsd: 93_534,
        rateVersion: "pii_redaction@500nano_per_char",
        occurredAt: NOW,
      });
    });
  });

  describe("when the model answers a batch routed as free", () => {
    /** @scenario "A free organization's call is recorded at a price of zero" */
    /** @scenario "The spend recorder prices a call as it was routed and reads no flag" */
    it("records the call at a price of zero and keeps our cost", async () => {
      const { spend, facts } = setup();

      await spend.record({ ...call, priced: false });

      expect(facts).toHaveLength(1);
      expect(facts[0]).toMatchObject({ priceNanoUsd: 0, costNanoUsd: 93_534, characters: 1_000 });
    });
  });

  describe("when the priced fact cannot be dispatched", () => {
    /** @scenario "A priced fact that cannot be recorded never fails the redaction" */
    it("resolves and logs the organization, the project, the request id and the price", async () => {
      const { spend, errors } = setup({ dispatchFails: true });

      await expect(spend.record(call)).resolves.toBeUndefined();

      expect(errors).toHaveLength(1);
      expect(errors[0]?.fields).toEqual({
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
        requestId: expect.stringMatching(/^piiredaction_/),
        priceNanoUsd: 500_000,
        errorName: "Error",
      });
    });
  });
});
