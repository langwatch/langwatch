/**
 * The organization's four sign-in security columns, read and written through its own twin.
 * @see specs/identity/org-account-lockout.feature
 * @see specs/identity/org-session-lifetime.feature
 */
import { OrganizationNotFoundError } from "@langwatch/organization-contract";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { MemoryOrganizationDatabase } from "../memory.organization.database.ts";
import { MemoryOrganizationRepository } from "../memory.organization.repository.ts";

const created = Temporal.Instant.from("2026-09-01T00:00:00Z");
const NO_RULE = {
  lockoutAfterFailedAttempts: 0,
  lockoutMinutes: 30,
  sessionIdleTimeoutMinutes: 0,
  sessionMaxLifetimeMinutes: 0,
};
const STRICT = {
  lockoutAfterFailedAttempts: 5,
  lockoutMinutes: 15,
  sessionIdleTimeoutMinutes: 60,
  sessionMaxLifetimeMinutes: 480,
};

function seeded() {
  const memory = MemoryOrganizationDatabase.create();
  for (const id of ["acme", "globex"]) {
    memory.organizations.set(id, {
      id,
      name: id,
      slug: id,
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
  }
  const member = (userId: string, organizationId: string, disabled = false) =>
    memory.organizationUsers.push({
      userId,
      organizationId,
      role: "MEMBER",
      disabledAt: disabled ? created : null,
      createdAt: created,
      updatedAt: created,
    });
  member("sam", "acme");
  member("sam", "globex", true);
  return MemoryOrganizationRepository.create({ memory });
}

describe("MemoryOrganizationRepository sign-in security policy", () => {
  describe("when an organization never set a rule", () => {
    it("reads as no rule", async () => {
      expect(await seeded().getSignInSecurityPolicy({ organizationId: "acme" })).toEqual(NO_RULE);
    });
  });

  describe("when the organization is unknown", () => {
    it("throws the organization's not-found error", async () => {
      await expect(
        seeded().getSignInSecurityPolicy({ organizationId: "nobody" }),
      ).rejects.toBeInstanceOf(OrganizationNotFoundError);
    });
  });

  describe("when a rule is updated", () => {
    it("reads back as written", async () => {
      const repository = seeded();
      await repository.updateSignInSecurityPolicy({ organizationId: "acme", policy: STRICT });

      expect(await repository.getSignInSecurityPolicy({ organizationId: "acme" })).toEqual(STRICT);
    });
  });

  describe("when a person's rules are read", () => {
    it("answers the organizations they are enabled in, and none for a stranger", async () => {
      const repository = seeded();
      await repository.updateSignInSecurityPolicy({ organizationId: "globex", policy: STRICT });

      expect(await repository.findSignInSecurityPoliciesForUser({ userId: "sam" })).toEqual([
        NO_RULE,
      ]);
      expect(await repository.findSignInSecurityPoliciesForUser({ userId: "kim" })).toEqual([]);
    });
  });

  describe("when the installation is scanned for configured rules", () => {
    it("answers only organizations that ask something", async () => {
      const repository = seeded();
      expect(await repository.findConfiguredSignInSecurityPolicies()).toEqual([]);

      await repository.updateSignInSecurityPolicy({ organizationId: "globex", policy: STRICT });

      expect(await repository.findConfiguredSignInSecurityPolicies()).toEqual([STRICT]);
    });
  });
});
