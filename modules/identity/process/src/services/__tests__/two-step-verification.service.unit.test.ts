/**
 * @vitest-environment node
 * The account standing and the administrator's member list (D06).
 * @see specs/identity/mfa-and-session-shape.feature
 */
import { createApiFixture } from "@langwatch/api-fixture";
import type { AuthApi } from "@langwatch/auth-contract";
import type { IdentityEmailResolution } from "@langwatch/identity-contract";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryOrganizationMfaRequirementMailChannel } from "../../channels/memory/memory.organization-mfa-requirement-mail.channel.ts";
import { MemoryTwoStepVerificationRepository } from "../../repositories/memory/memory.two-step-verification.repository.ts";
import { OrganizationMfaNotifierService } from "../organization-mfa-notifier.service.ts";
import { OrganizationMfaService } from "../organization-mfa.service.ts";
import { TwoStepAccountService } from "../two-step-account.service.ts";

function deploymentOffering(offered: boolean) {
  return { offersTwoStepVerification: () => offered };
}

const KEEP_LEGACY: IdentityEmailResolution = { kind: "keep_legacy" };

function accountService(
  accounts: MemoryTwoStepVerificationRepository,
  { offered = true, disable = vi.fn<AuthApi["disableTwoStepVerification"]>(async () => {}) } = {},
) {
  return TwoStepAccountService.create({
    accounts,
    deployment: deploymentOffering(offered),
    protocol: createApiFixture<AuthApi>({ disableTwoStepVerification: disable }),
  });
}

function organizationService(
  accounts: MemoryTwoStepVerificationRepository,
  {
    offered = true,
    entitled = true,
    sessionAmr = [] as string[],
    assertedAmr = [] as string[],
    mail = MemoryOrganizationMfaRequirementMailChannel.create(),
  } = {},
) {
  const entitlement = vi.fn(async () => entitled);
  const service = OrganizationMfaService.create({
    accounts,
    auth: createApiFixture<AuthApi>({
      offersTwoStepVerification: () => offered,
      findSessionAmr: async () => sessionAmr,
      findAssertedAmrForIdentifiers: async () => assertedAmr,
    }),
    notifier: OrganizationMfaNotifierService.create({
      accounts,
      mail,
      emails: { resolveEmail: async () => KEEP_LEGACY },
    }),
    entitled: entitlement,
  });
  return { service, entitlement, mail };
}

describe("two-step verification", () => {
  let accounts: MemoryTwoStepVerificationRepository;

  beforeEach(() => {
    accounts = MemoryTwoStepVerificationRepository.create();
    accounts.putPerson({
      userId: "user_ana",
      name: "Ana",
      email: "ana@acme.test",
      accountEnrollmentEnabled: true,
      passkeyCount: 0,
    });
    accounts.putPerson({
      userId: "user_bo",
      name: "Bo",
      email: "bo@acme.test",
      accountEnrollmentEnabled: false,
      passkeyCount: 2,
    });
    accounts.putOrganization({
      organizationId: "org_acme",
      name: "Acme",
      slug: "acme",
      mfaRequired: true,
    });
    accounts.putOrganization({
      organizationId: "org_open",
      name: "Open",
      slug: "open",
      mfaRequired: false,
    });
    accounts.putSeat({ organizationId: "org_acme", userId: "user_ana" });
    accounts.putSeat({ organizationId: "org_acme", userId: "user_bo" });
    accounts.putSeat({ organizationId: "org_open", userId: "user_ana" });
  });

  describe("given the caller reads their own security screen", () => {
    describe("when the deployment offers it", () => {
      it("answers whether it is on and which organizations will not let it go", async () => {
        const service = accountService(accounts);

        await expect(service.getStanding({ userId: "user_ana" })).resolves.toEqual({
          offered: true,
          enabled: true,
          holdsPasskey: false,
          requiringOrganizations: [{ organizationId: "org_acme", name: "Acme", slug: "acme" }],
        });
      });
    });

    describe("when the deployment offers none", () => {
      it("answers nothing at all rather than a setup nobody can finish", async () => {
        const service = accountService(accounts, { offered: false });

        await expect(service.getStanding({ userId: "user_ana" })).resolves.toEqual({
          offered: false,
          enabled: false,
          holdsPasskey: false,
          requiringOrganizations: [],
        });
      });
    });
  });

  describe("given an administrator reads the member list", () => {
    it("asks as though the requirement were on, so a passkey alone reads as unable", async () => {
      const members = await organizationService(accounts).service.findMemberFactors({
        organizationId: "org_acme",
      });

      expect(members).toEqual([
        expect.objectContaining({
          userId: "user_ana",
          satisfaction: { satisfied: true, by: "account_enrollment" },
        }),
        expect.objectContaining({
          userId: "user_bo",
          passkeyCount: 2,
          satisfaction: { satisfied: false, by: "none" },
        }),
      ]);
    });

    it("answers an organization with no seats with an empty list", async () => {
      await expect(
        organizationService(accounts).service.findMemberFactors({ organizationId: "org_none" }),
      ).resolves.toEqual([]);
    });
  });

  describe("given a person asks where they stand with one organization", () => {
    /** @scenario "A held member can read the standing needed to recover" */
    it("names the organization and says a member with nothing set up is held", async () => {
      const { service } = organizationService(accounts);

      await expect(
        service.getStanding({ userId: "user_bo", organizationId: "org_acme", sessionId: "s_1" }),
      ).resolves.toEqual({
        organizationId: "org_acme",
        organizationName: "Acme",
        required: true,
        satisfaction: { satisfied: false, by: "none" },
        holdsPasskey: true,
      });
    });

    it("counts the second factor the session they hold proved", async () => {
      const { service } = organizationService(accounts, { sessionAmr: ["phw"] });

      const standing = await service.getStanding({
        userId: "user_bo",
        organizationId: "org_acme",
        sessionId: "s_1",
      });

      expect(standing.satisfaction).toEqual({ satisfied: true, by: "sign_in", factors: ["phw"] });
    });

    /** @scenario "A stranger cannot use standing to inspect an organization" */
    it("tells a stranger nothing about the organization and reads none of their factors", async () => {
      const { service } = organizationService(accounts);
      const accountReads = vi.spyOn(accounts, "getAccountFactors");

      await expect(
        service.getStanding({
          userId: "user_mallory",
          organizationId: "org_acme",
          sessionId: null,
        }),
      ).resolves.toEqual({
        organizationId: "org_acme",
        organizationName: null,
        required: false,
        satisfaction: { satisfied: true, by: "not_required" },
        holdsPasskey: false,
      });
      expect(accountReads).not.toHaveBeenCalled();
    });
  });

  describe("given an administrator reads the requirement", () => {
    it("says there is no connection when the only one was torn down", async () => {
      accounts.putConnection({
        connectionId: "conn_old",
        organizationId: "org_acme",
        state: "TORN_DOWN",
      });
      const { service } = organizationService(accounts);

      await expect(service.getRequirement({ organizationId: "org_acme" })).resolves.toEqual({
        mfaRequired: true,
        offered: true,
        connection: { connected: false, assertedFactors: [], assertsSecondFactor: false },
      });
    });

    it("reports only recognised factors the connection's own sign-ins asserted", async () => {
      accounts.putConnection({
        connectionId: "conn_idp",
        organizationId: "org_acme",
        state: "ACTIVE",
      });
      accounts.putIdentifier({
        identifierId: "ident_bo",
        userId: "user_bo",
        providerId: "conn_idp",
      });
      const { service } = organizationService(accounts, { assertedAmr: ["saml", "mfa", "retina"] });

      const requirement = await service.getRequirement({ organizationId: "org_acme" });

      expect(requirement.connection).toEqual({
        connected: true,
        assertedFactors: ["saml", "mfa"],
        assertsSecondFactor: true,
      });
    });
  });

  describe("given an administrator changes the requirement", () => {
    it("turns it on and tells every active member who did it", async () => {
      const { service, mail } = organizationService(accounts);

      await expect(
        service.setRequirement({
          organizationId: "org_open",
          mfaRequired: true,
          actorUserId: "user_ana",
        }),
      ).resolves.toEqual({ previous: false, next: true });
      await expect(
        accounts.getOrganizationSetting({ organizationId: "org_open" }),
      ).resolves.toMatchObject({ mfaRequired: true });
      expect(mail.sent).toEqual([
        { to: "ana@acme.test", organizationName: "Open", actorName: "Ana", required: true },
      ]);
    });

    /** @scenario "Turning the requirement on without the plan is refused by the server" */
    it("refuses turning it on without the plan, leaves it where it was and tells nobody", async () => {
      const { service, mail } = organizationService(accounts, { entitled: false });

      await expect(
        service.setRequirement({
          organizationId: "org_open",
          mfaRequired: true,
          actorUserId: "user_ana",
        }),
      ).rejects.toMatchObject({ code: "identity_mfa_requirement_not_licensed" });
      await expect(
        accounts.getOrganizationSetting({ organizationId: "org_open" }),
      ).resolves.toMatchObject({ mfaRequired: false });
      expect(mail.sent).toEqual([]);
    });

    it("never asks the plan to turn it off", async () => {
      const { service, entitlement } = organizationService(accounts, { entitled: false });

      await expect(
        service.setRequirement({
          organizationId: "org_acme",
          mfaRequired: false,
          actorUserId: "user_ana",
        }),
      ).resolves.toEqual({ previous: true, next: false });
      expect(entitlement).not.toHaveBeenCalled();
    });

    it("changes nothing and tells nobody when it is already set that way", async () => {
      const { service, mail, entitlement } = organizationService(accounts);

      await expect(
        service.setRequirement({
          organizationId: "org_acme",
          mfaRequired: true,
          actorUserId: "user_ana",
        }),
      ).resolves.toEqual({ previous: true, next: true });
      expect(mail.sent).toEqual([]);
      expect(entitlement).not.toHaveBeenCalled();
    });

    it("refuses a requirement nobody could meet where the deployment offers none", async () => {
      const { service } = organizationService(accounts, { offered: false });

      await expect(
        service.setRequirement({
          organizationId: "org_open",
          mfaRequired: true,
          actorUserId: "user_ana",
        }),
      ).rejects.toMatchObject({ code: "identity_mfa_enrollment_required" });
    });
  });

  describe("given a person turns their own two-step verification off", () => {
    it("is refused while an organization requires it, before either proof is spent", async () => {
      const disable = vi.fn<AuthApi["disableTwoStepVerification"]>(async () => {});

      await expect(
        accountService(accounts, { disable }).disable({
          userId: "user_ana",
          password: "pw",
          code: "123456",
          headers: {},
        }),
      ).rejects.toMatchObject({ code: "identity_mfa_required_by_organization" });
      expect(disable).not.toHaveBeenCalled();
    });

    it("hands the request's own cookie to the plugin's re-proof and disable", async () => {
      accounts.putPerson({
        userId: "user_cy",
        name: "Cy",
        email: "cy@solo.test",
        accountEnrollmentEnabled: true,
        passkeyCount: 0,
      });
      const disable = vi.fn<AuthApi["disableTwoStepVerification"]>(async () => {});

      await expect(
        accountService(accounts, { disable }).disable({
          userId: "user_cy",
          code: "123456",
          headers: { cookie: "session=abc", "x-forwarded-for": ["a", "b"] },
        }),
      ).resolves.toEqual({ disabled: true });
      const [call] = disable.mock.calls;
      expect(call?.[0].headers.get("cookie")).toBe("session=abc");
      expect(call?.[0].headers.get("x-forwarded-for")).toBe("a, b");
    });
  });
});
