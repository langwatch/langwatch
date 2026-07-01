/**
 * @see specs/data-retention/storage-billing-backfill.feature
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/utils/logger/server", () => {
  const l = () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: () => l(),
  });
  return { createLogger: vi.fn(() => l()) };
});

import {
  type BackfillCandidate,
  StorageBillingBackfillService,
} from "../storageBillingBackfill.service";

const CANDIDATE: BackfillCandidate = {
  organizationId: "org-1",
  stripeSubscriptionId: "sub_1",
  plan: "GROWTH",
  currency: "EUR",
  interval: "month",
};

function makeService(
  overrides: Partial<{
    candidates: BackfillCandidate[];
    priceId: string | null;
    existingPriceIds: string[];
    attach: () => Promise<void>;
  }> = {},
) {
  const attachStorageItem = vi.fn(overrides.attach ?? (async () => {}));
  const getSubscriptionItemPriceIds = vi
    .fn()
    .mockResolvedValue(overrides.existingPriceIds ?? []);
  const service = new StorageBillingBackfillService({
    listPaidSubscriptions: vi
      .fn()
      .mockResolvedValue(overrides.candidates ?? [CANDIDATE]),
    resolveStoragePriceId: vi
      .fn()
      .mockReturnValue(
        overrides.priceId === undefined
          ? "price_storage_eur_m"
          : overrides.priceId,
      ),
    getSubscriptionItemPriceIds,
    attachStorageItem,
  });
  return { service, attachStorageItem, getSubscriptionItemPriceIds };
}

describe("StorageBillingBackfillService", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("given a paid subscription without the storage item", () => {
    /** @scenario The storage item is attached to a paid subscription that lacks it */
    it("attaches the item and counts it", async () => {
      const { service, attachStorageItem } = makeService({
        existingPriceIds: [],
      });

      const result = await service.run({ dryRun: false });

      expect(attachStorageItem).toHaveBeenCalledWith({
        stripeSubscriptionId: "sub_1",
        priceId: "price_storage_eur_m",
      });
      expect(result.attached).toBe(1);
    });
  });

  describe("given a subscription that already has the storage item", () => {
    /** @scenario A subscription that already has the item is skipped (idempotent) */
    it("does not attach again", async () => {
      const { service, attachStorageItem } = makeService({
        existingPriceIds: ["price_storage_eur_m"],
      });

      const result = await service.run({ dryRun: false });

      expect(attachStorageItem).not.toHaveBeenCalled();
      expect(result.alreadyAttached).toBe(1);
    });
  });

  describe("given no storage price for the plan/currency/interval", () => {
    /** @scenario A subscription with no matching storage price is skipped, never guessed */
    it("skips and counts it without attaching", async () => {
      const { service, attachStorageItem } = makeService({ priceId: null });

      const result = await service.run({ dryRun: false });

      expect(attachStorageItem).not.toHaveBeenCalled();
      expect(result.noPrice).toBe(1);
    });
  });

  describe("when run as a dry-run", () => {
    /** @scenario A dry-run reports what it would attach without mutating Stripe */
    it("does not call Stripe but counts the attach", async () => {
      const { service, attachStorageItem } = makeService({
        existingPriceIds: [],
      });

      const result = await service.run({ dryRun: true });

      expect(attachStorageItem).not.toHaveBeenCalled();
      expect(result.attached).toBe(1);
    });
  });

  describe("when attaching one subscription fails", () => {
    /** @scenario One subscription's failure does not abort the whole backfill */
    it("continues to the next and counts the failure", async () => {
      const second: BackfillCandidate = {
        ...CANDIDATE,
        organizationId: "org-2",
        stripeSubscriptionId: "sub_2",
      };
      const attach = vi
        .fn()
        .mockRejectedValueOnce(new Error("stripe error"))
        .mockResolvedValueOnce(undefined);
      const { service } = makeService({
        candidates: [CANDIDATE, second],
        attach,
      });

      const result = await service.run({ dryRun: false });

      expect(result.failed).toBe(1);
      expect(result.attached).toBe(1);
    });
  });
});
