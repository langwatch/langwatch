import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { MemoryOrganizationDatabase } from "../memory.organization.database.ts";
import { MemoryOrganizationRepository } from "../memory.organization.repository.ts";

const created = Temporal.Instant.from("2026-09-01T00:00:00Z");

function seeded(pricing: { pricingModel?: "TIERED" | "SEAT_EVENT"; currency?: "USD" | "EUR" }) {
  const memory = MemoryOrganizationDatabase.create();
  memory.organizations.set("org_1", {
    id: "org_1",
    name: "Acme",
    slug: "acme",
    supportContact: null,
    presenceEnabled: false,
    traceSharingEnabled: false,
    primaryIntent: null,
    s3Endpoint: null,
    s3AccessKeyId: null,
    s3SecretAccessKey: null,
    s3Bucket: null,
    stripeCustomerId: null,
    ...pricing,
    createdAt: created,
    updatedAt: created,
  });
  return MemoryOrganizationRepository.create({ memory });
}

describe("MemoryOrganizationRepository pricing read", () => {
  describe("when the organization holds a pricing model and a currency", () => {
    it("answers both as stored", async () => {
      const repository = seeded({ pricingModel: "TIERED", currency: "EUR" });

      expect(await repository.getPricing({ organizationId: "org_1" })).toEqual({
        pricingModel: "TIERED",
        currency: "EUR",
      });
    });
  });

  describe("when the organization is unknown", () => {
    it("answers no pricing model and the default currency instead of refusing", async () => {
      const repository = seeded({});

      expect(await repository.getPricing({ organizationId: "org_none" })).toEqual({
        pricingModel: null,
        currency: "EUR",
      });
    });
  });
});
