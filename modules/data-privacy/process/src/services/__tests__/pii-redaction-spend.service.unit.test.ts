import type { PiiRedactionSpendPricedEventData } from "@langwatch/data-privacy-contract/pii-redaction-spend";
import type { FeatureFlagApi, FeatureFlagTarget } from "@langwatch/feature-flag-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { PiiRedactionSpendService } from "../pii-redaction-spend.service.ts";

const ORGANIZATION_ID = "org_1";
const PROJECT_ID = "project_1";
const NOW = 1_700_000_000_000;

function setup({
  free = false,
  flagFails = false,
  dispatchFails = false,
}: { free?: boolean; flagFails?: boolean; dispatchFails?: boolean } = {}) {
  let clock = NOW;
  const flagReads: { key: string; target: FeatureFlagTarget }[] = [];
  const featureFlags = createApiFixture<FeatureFlagApi>({
    isEnabled: async (key, target) => {
      flagReads.push({ key, target });
      if (flagFails) throw new Error("flag store unreachable");
      return free;
    },
  });
  const facts: PiiRedactionSpendPricedEventData[] = [];
  const errors: { fields: Record<string, unknown>; message: string }[] = [];
  const spend = PiiRedactionSpendService.create({
    featureFlags,
    recordSpendPriced: async (fact) => {
      if (dispatchFails) throw new Error("queue unreachable");
      facts.push(fact);
    },
    log: { error: (fields, message) => errors.push({ fields, message }) },
    now: () => clock,
  });
  const advance = (ms: number) => {
    clock += ms;
  };
  return { spend, facts, flagReads, errors, advance };
}

const call = {
  organizationId: ORGANIZATION_ID,
  projectId: PROJECT_ID,
  texts: ["a".repeat(1_000)],
  recordKey: "trace-1:span-1",
  durationMs: 1_000,
};

describe("PiiRedactionSpendService", () => {
  describe("when the model answers a batch of 1,000 characters", () => {
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

    it("asks the free list for the organization", async () => {
      const { spend, flagReads } = setup();

      await spend.record(call);

      expect(flagReads).toEqual([
        {
          key: "release_pii_redaction_model_free",
          target: { kind: "organization", organizationId: ORGANIZATION_ID },
        },
      ]);
    });
  });

  describe("given an organization on the free list", () => {
    /** @scenario "A free organization's call is recorded at a price of zero" */
    it("records the call at a price of zero and keeps our cost", async () => {
      const { spend, facts } = setup({ free: true });

      await spend.record(call);

      expect(facts).toHaveLength(1);
      expect(facts[0]).toMatchObject({ priceNanoUsd: 0, costNanoUsd: 93_534, characters: 1_000 });
    });

    /** @scenario "The free list is read once per minute per organization" */
    it("reads the free list once per minute", async () => {
      const { spend, flagReads, advance } = setup({ free: true });

      await spend.record(call);
      advance(59_000);
      await spend.record(call);
      expect(flagReads).toHaveLength(1);

      advance(2_000);
      await spend.record(call);
      expect(flagReads).toHaveLength(2);
    });
  });

  describe("when the free list cannot be read", () => {
    it("records the call at zero and logs its full price at error", async () => {
      const { spend, facts, errors } = setup({ flagFails: true });

      await spend.record(call);

      expect(facts[0]).toMatchObject({ priceNanoUsd: 0 });
      expect(errors).toEqual([
        expect.objectContaining({
          fields: expect.objectContaining({
            organizationId: ORGANIZATION_ID,
            projectId: PROJECT_ID,
            priceNanoUsd: 500_000,
          }),
        }),
      ]);
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
