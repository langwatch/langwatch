import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { MemoryOrganizationDatabase } from "../memory.organization.database.ts";
import { MemoryOrganizationRepository } from "../memory.organization.repository.ts";

const created = Temporal.Instant.from("2026-09-01T00:00:00Z");
const first = Temporal.Instant.from("2026-10-01T10:00:00Z");
const later = Temporal.Instant.from("2026-10-02T10:00:00Z");

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

describe("MemoryOrganizationRepository Instant Evals opt-in", () => {
  describe("when the organization has not switched Instant Evals on", () => {
    it("reads as not opted in, as does an unknown organization", async () => {
      const { repository } = seeded();
      expect(await repository.isInstantEvalsOptedIn({ organizationId: "org_1" })).toBe(false);
      expect(await repository.isInstantEvalsOptedIn({ organizationId: "org_none" })).toBe(false);
    });
  });

  describe("when a member throws the switch and another throws it later", () => {
    /** @scenario "Enable records the moment and the member, once" */
    it("records the first moment and member and keeps them", async () => {
      const { memory, repository } = seeded();

      await repository.recordInstantEvalsOptIn({
        organizationId: "org_1",
        userId: "u_1",
        at: first,
      });
      await repository.recordInstantEvalsOptIn({
        organizationId: "org_1",
        userId: "u_2",
        at: later,
      });

      const row = memory.organizations.get("org_1");
      expect(row?.instantEvalsEnabledAt?.equals(first)).toBe(true);
      expect(row?.instantEvalsEnabledByUserId).toBe("u_1");
      expect(await repository.isInstantEvalsOptedIn({ organizationId: "org_1" })).toBe(true);
    });
  });
});
