import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { MemoryOrganizationDatabase } from "../memory.organization.database.ts";
import { MemoryOrganizationRepository } from "../memory.organization.repository.ts";

const created = Temporal.Instant.from("2026-09-01T00:00:00Z");
const first = Temporal.Instant.from("2026-11-26T10:00:00Z");
const later = Temporal.Instant.from("2026-11-27T10:00:00Z");

function seeded() {
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
    createdAt: created,
    updatedAt: created,
  });
  return { memory, repository: MemoryOrganizationRepository.create({ memory }) };
}

describe("MemoryOrganizationRepository PII redaction model acceptance", () => {
  describe("when no organization admin accepted the model's price", () => {
    /** @scenario "The acceptance is the organization's own record, kept once" */
    it("reads as not accepted, as does an unknown organization", async () => {
      const { repository } = seeded();
      expect(await repository.isPiiRedactionModelAccepted({ organizationId: "org_1" })).toBe(false);
      expect(await repository.isPiiRedactionModelAccepted({ organizationId: "org_none" })).toBe(
        false,
      );
    });
  });

  describe("when an admin accepts the price and another accepts it later", () => {
    /** @scenario "The acceptance is the organization's own record, kept once" */
    it("records the first moment and admin and keeps them", async () => {
      const { memory, repository } = seeded();

      await repository.recordPiiRedactionModelAcceptance({
        organizationId: "org_1",
        userId: "u_1",
        at: first,
      });
      await repository.recordPiiRedactionModelAcceptance({
        organizationId: "org_1",
        userId: "u_2",
        at: later,
      });

      const row = memory.organizations.get("org_1");
      expect(row?.piiRedactionModelAcceptedAt?.equals(first)).toBe(true);
      expect(row?.piiRedactionModelAcceptedByUserId).toBe("u_1");
      expect(await repository.isPiiRedactionModelAccepted({ organizationId: "org_1" })).toBe(true);
    });

    it("leaves the Instant Evals consent untouched", async () => {
      const { repository } = seeded();

      await repository.recordPiiRedactionModelAcceptance({
        organizationId: "org_1",
        userId: "u_1",
        at: first,
      });

      expect(await repository.isInstantEvalsOptedIn({ organizationId: "org_1" })).toBe(false);
    });
  });
});
