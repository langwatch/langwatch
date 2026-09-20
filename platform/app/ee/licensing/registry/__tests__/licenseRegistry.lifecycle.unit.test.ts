/**
 * A license after it is issued: revoking, reissuing, its term, its instance, its terms.
 *
 * Spec: specs/self-hosting/connected-services/license-registry.feature
 */
import { beforeEach, describe, expect, it } from "vitest";
import { validateLicense } from "../../validation";
import { LicenseRegistryService } from "../licenseRegistry.service";
import {
  buildService,
  issueInput,
  langwatchKeys,
  NEXT_YEAR,
  NOW,
  OPERATOR,
} from "./support/registryHarness";

describe("LicenseRegistryService", () => {
  let context: ReturnType<typeof buildService>;
  let acme: string;

  beforeEach(() => {
    context = buildService();
    acme = context.organizations.seed("ACME");
  });

  describe("given an active license in the registry", () => {
    let licenseId: string;

    beforeEach(async () => {
      licenseId = (await context.service.issue(issueInput(acme))).license.id;
    });

    describe("when an operator revokes it with a reason", () => {
      /** @scenario Revoking a license */
      it("reads as revoked and records who, when and why", async () => {
        const revoked = await context.service.revoke({
          id: licenseId,
          operatorId: OPERATOR,
          reason: "key leaked in a public repository",
        });

        expect(revoked).toMatchObject({
          status: "revoked",
          revokedAt: NOW,
          revokedById: OPERATOR,
          revokedReason: "key leaked in a public repository",
        });
      });

      it("refuses a second revoke with issued_license_not_active", async () => {
        await context.service.revoke({
          id: licenseId,
          operatorId: OPERATOR,
          reason: "leaked",
        });

        await expect(
          context.service.revoke({
            id: licenseId,
            operatorId: OPERATOR,
            reason: "again",
          }),
        ).rejects.toMatchObject({ code: "issued_license_not_active" });
      });
    });

    describe("when an operator revokes it after it resolved to a managed key", () => {
      /** @scenario Revoking a license revokes its managed key */
      it("ends the managed key, which is what tells every gateway to drop the credential", async () => {
        const { id: virtualKeyId } = await context.managedKeys.provision({
          organizationId: acme,
          licenseId: "lic",
        });
        await context.repository.update(licenseId, { virtualKeyId });

        await context.service.revoke({
          id: licenseId,
          operatorId: OPERATOR,
          reason: "leaked",
        });

        expect(context.managedKeys.keys.get(virtualKeyId)?.retiredBy).toBe(
          OPERATOR,
        );
        expect(context.managedKeys.active()).toEqual([]);
      });
    });

    describe("when an operator reissues it with 80 seats and a new term", () => {
      const NEW_TERM = new Date("2028-09-19T12:00:00.000Z");

      /** @scenario Reissuing a license */
      it("signs and records a new license that points at the one it replaces", async () => {
        const { license, licenseKey } = await context.service.reissue({
          id: licenseId,
          maxMembers: 80,
          expiresAt: NEW_TERM,
          operatorId: OPERATOR,
        });

        expect(license).toMatchObject({
          organizationId: acme,
          maxMembers: 80,
          expiresAt: NEW_TERM,
          replacesId: licenseId,
          status: "active",
        });
        expect(
          validateLicense({
            licenseKey,
            publicKey: langwatchKeys.publicKey,
            now: NOW,
          }).valid,
        ).toBe(true);
      });

      it("keeps the replaced license active until the install presents the new one", async () => {
        await context.service.reissue({
          id: licenseId,
          maxMembers: 80,
          expiresAt: NEW_TERM,
          operatorId: OPERATOR,
        });

        expect((await context.service.getById({ id: licenseId })).status).toBe(
          "active",
        );
      });

      it("holds the new license encrypted for delivery, never in the clear", async () => {
        const { license, licenseKey } = await context.service.reissue({
          id: licenseId,
          maxMembers: 80,
          expiresAt: NEW_TERM,
          operatorId: OPERATOR,
        });
        const row = context.repository.rows.find(
          (candidate) => candidate.id === license.id,
        );

        expect(row?.pendingDeliveryLicense).toMatch(/^enc\(/);
        expect(row?.pendingDeliveryLicense).not.toContain(licenseKey);
      });

      it("carries the entitlements, terms and instance binding over", async () => {
        await context.service.updateTerms({
          id: licenseId,
          operatorId: OPERATOR,
          services: ["instant_evals"],
          seatRateCents: 60_000,
          seatCurrency: "USD",
        });
        await context.repository.update(licenseId, {
          instanceId: "instance-a",
          instanceBoundAt: NOW,
        });

        const { license } = await context.service.reissue({
          id: licenseId,
          maxMembers: 80,
          expiresAt: NEW_TERM,
          operatorId: OPERATOR,
        });

        expect(license).toMatchObject({
          services: ["instant_evals"],
          seatRateCents: 60_000,
          seatCurrency: "USD",
          instanceId: "instance-a",
        });
      });

      it("refuses to reissue a license that was already replaced", async () => {
        await context.service.reissue({
          id: licenseId,
          maxMembers: 80,
          expiresAt: NEW_TERM,
          operatorId: OPERATOR,
        });

        await expect(
          context.service.reissue({
            id: licenseId,
            maxMembers: 90,
            expiresAt: NEW_TERM,
            operatorId: OPERATOR,
          }),
        ).rejects.toMatchObject({ code: "license_already_reissued" });
      });
    });

    describe("when an operator reissues a revoked license", () => {
      it("refuses with issued_license_not_active", async () => {
        await context.service.revoke({
          id: licenseId,
          operatorId: OPERATOR,
          reason: "leaked",
        });

        await expect(
          context.service.reissue({
            id: licenseId,
            maxMembers: 80,
            expiresAt: NEXT_YEAR,
            operatorId: OPERATOR,
          }),
        ).rejects.toMatchObject({ code: "issued_license_not_active" });
      });
    });

    describe("when its term has ended", () => {
      /** @scenario A license past its term reads as expired */
      it("reads as expired without the row having been edited", async () => {
        const later = new LicenseRegistryService({
          repository: context.repository,
          seatReports: context.seatReports,
          organizations: context.organizations,
          managedKeys: context.managedKeys,
          contractBudgets: context.contractBudgets,
          signingKey: () => langwatchKeys.privateKey,
          publicKey: langwatchKeys.publicKey,
          encrypt: (plain) => plain,
          now: () => new Date("2027-09-20T00:00:00.000Z"),
        });
        const before = JSON.stringify(context.repository.rows[0]);

        expect((await later.getById({ id: licenseId })).status).toBe("expired");
        expect(JSON.stringify(context.repository.rows[0])).toBe(before);
      });

      it("can still be reissued, which is how a lapsed license is renewed", async () => {
        const later = new LicenseRegistryService({
          repository: context.repository,
          seatReports: context.seatReports,
          organizations: context.organizations,
          managedKeys: context.managedKeys,
          contractBudgets: context.contractBudgets,
          signingKey: () => langwatchKeys.privateKey,
          publicKey: langwatchKeys.publicKey,
          encrypt: (plain) => plain,
          now: () => new Date("2027-09-20T00:00:00.000Z"),
        });

        const { license } = await later.reissue({
          id: licenseId,
          maxMembers: 50,
          expiresAt: new Date("2028-09-20T00:00:00.000Z"),
          operatorId: OPERATOR,
        });

        expect(license.status).toBe("active");
      });
    });

    describe("when it is bound to an instance and an operator resets the binding", () => {
      /** @scenario Resetting the instance binding */
      it("has no instance bound afterwards", async () => {
        await context.repository.update(licenseId, {
          instanceId: "instance-a",
          instanceBoundAt: NOW,
        });

        const reset = await context.service.resetInstanceBinding({
          id: licenseId,
        });

        expect(reset).toMatchObject({
          instanceId: null,
          instanceBoundAt: null,
        });
      });

      it("tells every gateway to resolve the license again", async () => {
        const { id: virtualKeyId } = await context.managedKeys.provision({
          organizationId: acme,
          licenseId: "lic",
        });
        await context.repository.update(licenseId, {
          instanceId: "instance-a",
          instanceBoundAt: NOW,
          virtualKeyId,
        });

        await context.service.resetInstanceBinding({ id: licenseId });

        expect(context.managedKeys.invalidated).toEqual([virtualKeyId]);
      });
    });

    describe("when an operator links it to another customer organization", () => {
      it("ends the managed key it had on the first organization", async () => {
        const other = context.organizations.seed("ACME Europe");
        const { id: virtualKeyId } = await context.managedKeys.provision({
          organizationId: acme,
          licenseId: "lic",
        });
        await context.repository.update(licenseId, { virtualKeyId });

        const linked = await context.service.linkToOrganization({
          id: licenseId,
          organizationId: other,
          operatorId: OPERATOR,
        });

        expect(linked).toMatchObject({
          organizationId: other,
          virtualKeyId: null,
        });
        expect(context.managedKeys.active()).toEqual([]);
      });
    });

    describe("when an operator switches on a hosted service", () => {
      /** @scenario Editing entitlements does not reissue the license */
      it("lists the service as entitled and leaves the license identity unchanged", async () => {
        const before = context.repository.rows[0];
        const identity = {
          licenseId: before?.licenseId,
          tokenHash: before?.tokenHash,
        };

        const updated = await context.service.updateTerms({
          id: licenseId,
          operatorId: OPERATOR,
          services: ["instant_evals"],
        });

        expect(updated.services).toEqual(["instant_evals"]);
        expect(context.repository.rows).toHaveLength(1);
        expect(context.repository.rows[0]).toMatchObject(identity);
      });
    });

    describe("when an operator sets the commercial terms", () => {
      /** @scenario Commercial terms are set on the registry row */
      it("records the allowance, seat rate, commit, overage switch and maximum", async () => {
        const updated = await context.service.updateTerms({
          id: licenseId,
          operatorId: OPERATOR,
          seatOverageAllowance: 5,
          seatRateCents: 60_000,
          seatCurrency: "USD",
          commitUsdCents: 100_000,
          overageEnabled: true,
          overageMaxUsdCents: 50_000,
        });

        expect(updated).toMatchObject({
          seatOverageAllowance: 5,
          effectiveSeatOverageAllowance: 5,
          seatRateCents: 60_000,
          seatCurrency: "USD",
          commitUsdCents: 100_000,
          overageEnabled: true,
          overageMaxUsdCents: 50_000,
        });
      });

      /** @scenario An overage maximum without overage enabled is refused */
      it("refuses an overage maximum while on-demand overage is off", async () => {
        await expect(
          context.service.updateTerms({
            id: licenseId,
            operatorId: OPERATOR,
            overageEnabled: false,
            overageMaxUsdCents: 50_000,
          }),
        ).rejects.toMatchObject({
          code: "license_overage_max_requires_overage",
        });
      });

      it("refuses an overage maximum when the row already has overage off", async () => {
        await expect(
          context.service.updateTerms({
            id: licenseId,
            operatorId: OPERATOR,
            overageMaxUsdCents: 50_000,
          }),
        ).rejects.toMatchObject({
          code: "license_overage_max_requires_overage",
        });
      });

      it("clears the overage maximum when overage is switched off", async () => {
        await context.service.updateTerms({
          id: licenseId,
          operatorId: OPERATOR,
          overageEnabled: true,
          overageMaxUsdCents: 50_000,
        });

        const updated = await context.service.updateTerms({
          id: licenseId,
          operatorId: OPERATOR,
          overageEnabled: false,
        });

        expect(updated.overageMaxUsdCents).toBeNull();
      });
    });

    describe("when the license id is unknown", () => {
      it("refuses with issued_license_not_found", async () => {
        await expect(
          context.service.getById({ id: "il_missing" }),
        ).rejects.toMatchObject({ code: "issued_license_not_found" });
      });
    });
  });

});
