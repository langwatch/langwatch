/**
 * @vitest-environment node
 * The account standing and the administrator's member list (D06).
 * @see specs/identity/mfa-and-session-shape.feature
 */
import { beforeEach, describe, expect, it } from "vitest";

import { MemoryTwoStepVerificationRepository } from "../../repositories/memory/memory.two-step-verification.repository.ts";
import { OrganizationMfaService } from "../organization-mfa.service.ts";
import { TwoStepAccountService } from "../two-step-account.service.ts";

function deploymentOffering(offered: boolean) {
  return { offersTwoStepVerification: () => offered };
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
        const service = TwoStepAccountService.create({
          accounts,
          deployment: deploymentOffering(true),
        });

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
        const service = TwoStepAccountService.create({
          accounts,
          deployment: deploymentOffering(false),
        });

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
      const members = await OrganizationMfaService.create(accounts).findMemberFactors({
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
        OrganizationMfaService.create(accounts).findMemberFactors({ organizationId: "org_none" }),
      ).resolves.toEqual([]);
    });
  });
});
