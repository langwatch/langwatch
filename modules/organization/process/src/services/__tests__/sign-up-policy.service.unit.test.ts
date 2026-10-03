/**
 * @vitest-environment node
 * @see specs/auth/sign-up-restriction.feature
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { UserApi } from "@langwatch/user-contract";
import { beforeEach, describe, expect, it } from "vitest";

import { SignUpPolicyRepository } from "../../repositories/sign-up-policy.repository.ts";
import { SignUpPolicyService, type SignUpPolicySettings } from "../sign-up-policy.service.ts";

class CountingRepository extends SignUpPolicyRepository {
  invited = new Set<string>();
  organizations = 1;
  reads = 0;

  async findPendingInviteCodes({ email }: { email: string }): Promise<string[]> {
    this.reads++;
    return this.invited.has(email) ? [`code-for-${email}`] : [];
  }

  async hasAnyOrganization(): Promise<boolean> {
    this.reads++;
    return this.organizations > 0;
  }
}

describe("SignUpPolicyService", () => {
  let repository: CountingRepository;
  let settings: SignUpPolicySettings;
  let accounts: number;
  let operators: Set<string>;
  let proven: Record<string, readonly string[]>;
  let reads: number;

  const policy = () =>
    SignUpPolicyService.create({
      settings,
      repository,
      users: createApiFixture<UserApi>({
        hasAnyAccount: async () => {
          reads++;
          return accounts > 0;
        },
        isOperator: async ({ userId }) => {
          reads++;
          return operators.has(userId);
        },
      }),
      findProvenAddresses: async ({ userId }) => {
        reads++;
        return proven[userId] ?? [];
      },
    });

  beforeEach(() => {
    repository = new CountingRepository();
    settings = { mode: "open", allowedDomains: [], adminEmails: [] };
    accounts = 1;
    operators = new Set();
    proven = {};
    reads = 0;
  });

  describe("when sign-up is open with no allowed domains", () => {
    /** @scenario "Open sign-up admits anybody" */
    it("admits any address without reading anything", async () => {
      await expect(policy().checkSignUp({ email: "sam@acme.com" })).resolves.toEqual({
        allowed: true,
        via: "open",
      });
      expect(repository.reads + reads).toBe(0);
    });

    it("lets any signed-in member create an organization", async () => {
      await expect(
        policy().checkOrganizationCreation({ userId: "user_sam", email: "sam@acme.com" }),
      ).resolves.toEqual({ allowed: true, via: "open" });
      expect(repository.reads + reads).toBe(0);
    });

    it("names no waiting invitation and reads nothing", async () => {
      repository.invited.add("sam@acme.com");
      proven = { user_sam: ["sam@acme.com"] };

      await expect(
        policy().getPendingInvitation({ userId: "user_sam", email: "sam@acme.com" }),
      ).resolves.toEqual({ inviteCode: null });
      expect(repository.reads + reads).toBe(0);
    });
  });

  describe("when sign-up is invite-only", () => {
    beforeEach(() => {
      settings = { ...settings, mode: "invite_only" };
    });

    /** @scenario "Invite-only refuses an address with no invitation" */
    it("refuses an address with no invitation", async () => {
      await expect(policy().checkSignUp({ email: "stranger@example.com" })).resolves.toEqual({
        allowed: false,
        reason: "invite_only",
      });
    });

    /** @scenario "Invite-only admits an address holding a pending invitation" */
    it("admits an address holding a pending invitation, whatever its case", async () => {
      repository.invited.add("sam@acme.com");

      await expect(policy().checkSignUp({ email: "Sam@Acme.com" })).resolves.toEqual({
        allowed: true,
        via: "invitation",
      });
    });

    describe("when a signed-in person belongs to no organization", () => {
      it("names the invitation waiting for one of their proven addresses", async () => {
        repository.invited.add("sam@acme.com");
        proven = { user_sam: ["other@acme.com", "Sam@Acme.com"] };

        await expect(
          policy().getPendingInvitation({ userId: "user_sam", email: "other@acme.com" }),
        ).resolves.toEqual({ inviteCode: "code-for-sam@acme.com" });
      });

      it("names none when no address of theirs was invited", async () => {
        proven = { user_stranger: ["stranger@example.com"] };

        await expect(
          policy().getPendingInvitation({ userId: "user_stranger", email: null }),
        ).resolves.toEqual({ inviteCode: null });
      });
    });

    /** @scenario "An address in ADMIN_EMAILS can always sign up" */
    it("admits an address listed in ADMIN_EMAILS", async () => {
      settings = { ...settings, adminEmails: ["Ops@acme.com"] };

      await expect(policy().checkSignUp({ email: "ops@acme.com" })).resolves.toEqual({
        allowed: true,
        via: "instance_admin",
      });
    });

    describe("when the installation has no accounts", () => {
      beforeEach(() => {
        accounts = 0;
      });

      /** @scenario "The first account on an empty installation is admitted when ADMIN_EMAILS is empty" */
      it("admits the first account when ADMIN_EMAILS is empty", async () => {
        await expect(policy().checkSignUp({ email: "founder@acme.com" })).resolves.toEqual({
          allowed: true,
          via: "first_account",
        });
      });

      /** @scenario "Setting ADMIN_EMAILS closes the first-account window" */
      it("refuses anybody else once ADMIN_EMAILS names the administrator", async () => {
        settings = { ...settings, adminEmails: ["ops@acme.com"] };

        await expect(policy().checkSignUp({ email: "stranger@example.com" })).resolves.toEqual({
          allowed: false,
          reason: "invite_only",
        });
      });

      it("still applies the allowed domains to the first account", async () => {
        settings = { ...settings, allowedDomains: ["acme.com"] };

        await expect(policy().checkSignUp({ email: "stranger@example.com" })).resolves.toEqual({
          allowed: false,
          reason: "domain_not_allowed",
        });
      });
    });

    describe("when a member creates an organization", () => {
      /** @scenario "Invite-only stops a member founding an organization" */
      it("refuses a member who is not an instance administrator", async () => {
        await expect(
          policy().checkOrganizationCreation({ userId: "user_sam", email: "sam@acme.com" }),
        ).resolves.toEqual({ allowed: false, reason: "invite_only" });
        await expect(
          policy().assertOrganizationCreation({ userId: "user_sam", email: "sam@acme.com" }),
        ).rejects.toMatchObject({ code: "organization_creation_restricted" });
      });

      /** @scenario "An instance administrator can create an organization on an invite-only installation" */
      it("lets an address in ADMIN_EMAILS create one", async () => {
        settings = { ...settings, adminEmails: ["ops@acme.com"] };

        await expect(
          policy().checkOrganizationCreation({ userId: "user_ops", email: "OPS@acme.com" }),
        ).resolves.toEqual({ allowed: true, via: "instance_admin" });
      });

      it("lets a platform operator create one", async () => {
        operators.add("user_ops");

        await expect(
          policy().checkOrganizationCreation({ userId: "user_ops", email: "ops@acme.com" }),
        ).resolves.toEqual({ allowed: true, via: "instance_admin" });
      });

      /** @scenario "The first organization on an invite-only installation can be created" */
      it("lets the first organization on the installation be created", async () => {
        repository.organizations = 0;

        await expect(
          policy().checkOrganizationCreation({ userId: "user_founder", email: "founder@acme.com" }),
        ).resolves.toEqual({ allowed: true, via: "first_organization" });
      });
    });
  });

  describe("when allowed domains are set", () => {
    beforeEach(() => {
      settings = { ...settings, allowedDomains: ["acme.com"] };
    });

    /** @scenario "An address outside the allowed domains is refused" */
    it("refuses an address outside them", async () => {
      await expect(policy().checkSignUp({ email: "stranger@example.com" })).resolves.toEqual({
        allowed: false,
        reason: "domain_not_allowed",
      });
    });

    it("admits an address inside them", async () => {
      await expect(policy().checkSignUp({ email: "sam@ACME.com" })).resolves.toEqual({
        allowed: true,
        via: "open",
      });
    });

    it("does not admit a subdomain or a look-alike suffix", async () => {
      for (const email of ["sam@eu.acme.com", "sam@notacme.com"]) {
        await expect(policy().checkSignUp({ email })).resolves.toEqual({
          allowed: false,
          reason: "domain_not_allowed",
        });
      }
    });

    /** @scenario "An invited address outside the allowed domains is admitted" */
    it("admits an invited address outside them", async () => {
      repository.invited.add("contractor@example.com");

      await expect(policy().checkSignUp({ email: "contractor@example.com" })).resolves.toEqual({
        allowed: true,
        via: "invitation",
      });
    });
  });
});
