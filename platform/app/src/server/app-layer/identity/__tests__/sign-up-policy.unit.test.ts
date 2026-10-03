import { beforeEach, describe, expect, it } from "vitest";
import {
  parseAllowedDomains,
  SignUpPolicy,
  type SignUpPolicyConfig,
  type SignUpPolicyRepository,
} from "../sign-up-policy";

class FakeRepository implements SignUpPolicyRepository {
  invited = new Set<string>();
  users = 1;
  organizations = 1;
  reads = 0;

  async hasPendingInvite({ email }: { email: string }) {
    this.reads++;
    return this.invited.has(email);
  }
  async findPendingInviteCode({ email }: { email: string }) {
    this.reads++;
    return this.invited.has(email) ? `code-for-${email}` : null;
  }
  async anyUserExists() {
    this.reads++;
    return this.users > 0;
  }
  async anyOrganizationExists() {
    this.reads++;
    return this.organizations > 0;
  }
}

describe("SignUpPolicy", () => {
  let repository: FakeRepository;
  let config: SignUpPolicyConfig;
  const policy = () => new SignUpPolicy({ config: () => config, repository });

  beforeEach(() => {
    repository = new FakeRepository();
    config = { mode: "open", allowedDomains: [], adminEmails: [] };
  });

  describe("when sign-up is open with no allowed domains", () => {
    /** @scenario "Open sign-up admits anybody" */
    it("admits any address without reading the database", async () => {
      await expect(
        policy().checkSignUp({ email: "sam@acme.com" }),
      ).resolves.toEqual({ allowed: true, via: "open" });
      expect(repository.reads).toBe(0);
    });

    it("lets any signed-in member create an organization", async () => {
      await expect(
        policy().checkOrganizationCreation({ email: "sam@acme.com" }),
      ).resolves.toEqual({ allowed: true, via: "open" });
      expect(repository.reads).toBe(0);
    });

    it("names no waiting invitation and reads nothing", async () => {
      repository.invited.add("sam@acme.com");
      let asked = 0;
      await expect(
        policy().pendingInvitationFor({
          addresses: async () => {
            asked++;
            return ["sam@acme.com"];
          },
        }),
      ).resolves.toBeNull();
      expect(asked).toBe(0);
      expect(repository.reads).toBe(0);
    });
  });

  describe("when sign-up is invite-only", () => {
    beforeEach(() => {
      config = { ...config, mode: "invite_only" };
    });

    /** @scenario "Invite-only refuses an address with no invitation" */
    it("refuses an address with no invitation", async () => {
      await expect(
        policy().checkSignUp({ email: "stranger@example.com" }),
      ).resolves.toEqual({ allowed: false, reason: "invite_only" });
    });

    it("throws the handled refusal from assertSignUp", async () => {
      await expect(
        policy().assertSignUp({ email: "stranger@example.com" }),
      ).rejects.toMatchObject({ code: "auth_sign_up_restricted" });
    });

    /** @scenario "Invite-only admits an address holding a pending invitation" */
    it("admits an address holding a pending invitation, whatever its case", async () => {
      repository.invited.add("sam@acme.com");
      await expect(
        policy().checkSignUp({ email: "Sam@Acme.com" }),
      ).resolves.toEqual({ allowed: true, via: "invitation" });
    });

    describe("when a signed-in person belongs to no organization", () => {
      /** @scenario "An invited member who signed up from the sign-in screen is sent to their invitation" */
      it("names the invitation waiting for one of their addresses", async () => {
        repository.invited.add("sam@acme.com");
        await expect(
          policy().pendingInvitationFor({
            addresses: async () => ["other@acme.com", "Sam@Acme.com"],
          }),
        ).resolves.toEqual({ inviteCode: "code-for-sam@acme.com" });
      });

      it("names none when no address of theirs was invited", async () => {
        await expect(
          policy().pendingInvitationFor({
            addresses: async () => ["stranger@example.com"],
          }),
        ).resolves.toBeNull();
      });
    });

    /** @scenario "An address in ADMIN_EMAILS can always sign up" */
    it("admits an address listed in ADMIN_EMAILS", async () => {
      config = { ...config, adminEmails: ["ops@acme.com"] };
      await expect(
        policy().checkSignUp({ email: "ops@acme.com" }),
      ).resolves.toEqual({ allowed: true, via: "instance_admin" });
    });

    describe("when the installation has no users", () => {
      beforeEach(() => {
        repository.users = 0;
      });

      /** @scenario "The first account on an empty installation is admitted when ADMIN_EMAILS is empty" */
      it("admits the first account when ADMIN_EMAILS is empty", async () => {
        await expect(
          policy().checkSignUp({ email: "founder@acme.com" }),
        ).resolves.toEqual({ allowed: true, via: "first_account" });
      });

      /** @scenario "Setting ADMIN_EMAILS closes the first-account window" */
      it("refuses anybody else once ADMIN_EMAILS names the administrator", async () => {
        config = { ...config, adminEmails: ["ops@acme.com"] };
        await expect(
          policy().checkSignUp({ email: "stranger@example.com" }),
        ).resolves.toEqual({ allowed: false, reason: "invite_only" });
      });

      it("still applies the allowed domains to the first account", async () => {
        config = { ...config, allowedDomains: ["acme.com"] };
        await expect(
          policy().checkSignUp({ email: "stranger@example.com" }),
        ).resolves.toEqual({ allowed: false, reason: "domain_not_allowed" });
      });
    });

    describe("when a member creates an organization", () => {
      /** @scenario "Invite-only stops a member founding an organization" */
      it("refuses a member who is not an instance administrator", async () => {
        await expect(
          policy().checkOrganizationCreation({ email: "sam@acme.com" }),
        ).resolves.toEqual({ allowed: false, reason: "invite_only" });
      });

      /** @scenario "An instance administrator can create an organization on an invite-only installation" */
      it("lets an instance administrator create one", async () => {
        config = { ...config, adminEmails: ["ops@acme.com"] };
        await expect(
          policy().checkOrganizationCreation({ email: "OPS@acme.com" }),
        ).resolves.toEqual({ allowed: true, via: "instance_admin" });
      });

      /** @scenario "The first organization on an invite-only installation can be created" */
      it("lets the first organization on the installation be created", async () => {
        repository.organizations = 0;
        await expect(
          policy().checkOrganizationCreation({ email: "founder@acme.com" }),
        ).resolves.toEqual({ allowed: true, via: "first_organization" });
      });
    });
  });

  describe("when allowed domains are set", () => {
    beforeEach(() => {
      config = { ...config, allowedDomains: ["acme.com"] };
    });

    /** @scenario "An address outside the allowed domains is refused" */
    it("refuses an address outside them", async () => {
      await expect(
        policy().checkSignUp({ email: "stranger@example.com" }),
      ).resolves.toEqual({ allowed: false, reason: "domain_not_allowed" });
    });

    it("admits an address inside them", async () => {
      await expect(
        policy().checkSignUp({ email: "sam@ACME.com" }),
      ).resolves.toEqual({ allowed: true, via: "open" });
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
      await expect(
        policy().checkSignUp({ email: "contractor@example.com" }),
      ).resolves.toEqual({ allowed: true, via: "invitation" });
    });
  });
});

describe("parseAllowedDomains()", () => {
  it("trims, lowercases, drops a leading @ and blanks", () => {
    expect(parseAllowedDomains(" Acme.com, @acme.io ,, ")).toEqual([
      "acme.com",
      "acme.io",
    ]);
  });

  it("answers an empty list when unset", () => {
    expect(parseAllowedDomains(undefined)).toEqual([]);
  });
});
