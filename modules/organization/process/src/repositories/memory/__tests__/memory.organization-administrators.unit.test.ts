import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { MemoryOrganizationDatabase } from "../memory.organization.database.ts";
import { MemoryOrganizationRepository } from "../memory.organization.repository.ts";

const at = Temporal.Instant.from("2026-09-01T00:00:00Z");

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
    createdAt: at,
    updatedAt: at,
  });
  for (const [id, role] of [
    ["user_admin", "ADMIN"],
    ["user_member", "MEMBER"],
  ] as const) {
    memory.users.set(id, { id, name: id, email: `${id}@acme.test`, deactivatedAt: null });
    memory.organizationUsers.push({
      userId: id,
      organizationId: "org_1",
      role,
      disabledAt: null,
      createdAt: at,
      updatedAt: at,
    });
  }
  return MemoryOrganizationRepository.create({ memory });
}

describe("MemoryOrganizationRepository usage-limit recipients", () => {
  describe("when billing reads an organization with its administrators", () => {
    /** @scenario "Reads the organization with its administrators only" */
    it("lists only the administrators", async () => {
      await expect(seeded().getWithAdministrators("org_1")).resolves.toEqual({
        id: "org_1",
        name: "Acme",
        sentPlanLimitAlert: null,
        administrators: [
          { userId: "user_admin", name: "user_admin", email: "user_admin@acme.test" },
        ],
      });
    });

    /** @scenario "Refuses an unknown organization by code" */
    it("refuses an unknown organization", async () => {
      await expect(seeded().getWithAdministrators("org_missing")).rejects.toMatchObject({
        code: "organization_not_found",
      });
    });
  });

  describe("when billing records the plan-limit alert", () => {
    /** @scenario "Records when the plan-limit alert was sent" */
    it("reads back the moment it was sent", async () => {
      const repository = seeded();
      await repository.updateSentPlanLimitAlert({ organizationId: "org_1", sentAt: at });

      const organization = await repository.getWithAdministrators("org_1");

      expect(organization.sentPlanLimitAlert?.equals(at)).toBe(true);
    });
  });
});
