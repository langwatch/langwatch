import { describe, expect, it } from "vitest";
import { PlanTypes, SUBSCRIBABLE_PLANS, SubscriptionStatus } from "../planTypes";
import {
  PlanTypes as PrismaPlanTypes,
  SubscriptionStatus as PrismaSubscriptionStatus,
} from "@prisma/client";

describe("SUBSCRIBABLE_PLANS", () => {
  it("includes FREE for downgrade/cancel flow", () => {
    expect(SUBSCRIBABLE_PLANS).toContain(PlanTypes.FREE);
  });

  it("excludes ENTERPRISE from self-serve subscription flows", () => {
    expect(SUBSCRIBABLE_PLANS).not.toContain(PlanTypes.ENTERPRISE);
  });
});

describe("Prisma enum parity", () => {
  describe("when comparing with Prisma enums", () => {
    it("has PlanTypes values matching Prisma PlanTypes enum", () => {
      for (const value of Object.values(PlanTypes)) {
        expect(Object.values(PrismaPlanTypes)).toContain(value);
      }
    });

    it("has SubscriptionStatus values matching Prisma SubscriptionStatus enum", () => {
      for (const value of Object.values(SubscriptionStatus)) {
        expect(Object.values(PrismaSubscriptionStatus)).toContain(value);
      }
    });
  });
});
