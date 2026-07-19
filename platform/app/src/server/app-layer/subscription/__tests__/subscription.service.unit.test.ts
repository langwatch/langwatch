import { describe, expect, it } from "vitest";
import type { SubscriptionService } from "../subscription.service";
import {
  NullSubscriptionRepository,
  type SubscriptionRepository,
} from "../subscription.repository";
import type { EESubscriptionService } from "../../../../../ee/billing/services/subscription.service";

// --------------------------------------------------------------------------
// Type-level conformance checks (compile-time only, no runtime cost)
// --------------------------------------------------------------------------
type Assert<T extends true> = T;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _AssertEEConforms = Assert<
  EESubscriptionService extends SubscriptionService ? true : false
>;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _AssertNullRepoConforms = Assert<
  NullSubscriptionRepository extends SubscriptionRepository ? true : false
>;

describe("NullSubscriptionRepository", () => {
  const repository = new NullSubscriptionRepository();

  describe("findLastNonCancelled()", () => {
    describe("when querying for any organization", () => {
      it("returns null", async () => {
        const result = await repository.findLastNonCancelled("org_123");

        expect(result).toBeNull();
      });
    });
  });

  describe("createPending()", () => {
    describe("when called in self-hosted mode", () => {
      it("resolves without throwing", async () => {
        await expect(
          repository.createPending({
            organizationId: "org_123",
            plan: "LAUNCH",
          }),
        ).resolves.not.toThrow();
      });
    });
  });

  describe("updateStatus()", () => {
    describe("when called in self-hosted mode", () => {
      it("resolves without throwing", async () => {
        await expect(
          repository.updateStatus({
            id: "sub_123",
            status: "ACTIVE",
          }),
        ).resolves.not.toThrow();
      });
    });
  });

  describe("updatePlan()", () => {
    describe("when called in self-hosted mode", () => {
      it("resolves without throwing", async () => {
        await expect(
          repository.updatePlan({
            id: "sub_123",
            plan: "LAUNCH",
          }),
        ).resolves.not.toThrow();
      });
    });
  });
});
