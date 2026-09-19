import { generateKeyPairSync } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { generateLicenseKey } from "../../licenseGenerationService";
import { licenseTokenFromKey, registryHashForToken } from "../../licenseToken";
import { parseLicenseKey, validateLicense } from "../../validation";
import { LicenseRegistryService } from "../licenseRegistry.service";
import {
  InMemoryConnectManagedKeys,
  InMemoryCustomerOrganizations,
  InMemoryIssuedLicenseRepository,
} from "./registryFakes";

const NOW = new Date("2026-09-19T12:00:00.000Z");
const NEXT_YEAR = new Date("2027-09-19T12:00:00.000Z");
const OPERATOR = "user_operator";

function makeKeyPair() {
  return generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
}

const langwatchKeys = makeKeyPair();
const strangerKeys = makeKeyPair();

/**
 * `signing: "unconfigured"` rather than `privateKey: undefined`: a destructuring
 * default would replace an explicit undefined with the real key, and the
 * unconfigured case would pass by issuing a license.
 */
function buildService({
  signing = "configured",
}: {
  signing?: "configured" | "unconfigured";
} = {}) {
  const repository = new InMemoryIssuedLicenseRepository(NOW);
  const organizations = new InMemoryCustomerOrganizations();
  const managedKeys = new InMemoryConnectManagedKeys();
  const service = new LicenseRegistryService({
    repository,
    organizations,
    managedKeys,
    signingKey: () =>
      signing === "configured" ? langwatchKeys.privateKey : undefined,
    publicKey: langwatchKeys.publicKey,
    encrypt: (plain) => `enc(${Buffer.from(plain).toString("base64")})`,
    now: () => NOW,
  });
  return { service, repository, organizations, managedKeys };
}

const issueInput = (organizationId: string) => ({
  customer: { organizationId },
  email: "ops@acme.test",
  planType: "ENTERPRISE",
  maxMembers: 50,
  expiresAt: NEXT_YEAR,
  operatorId: OPERATOR,
});

describe("LicenseRegistryService", () => {
  let context: ReturnType<typeof buildService>;
  let acme: string;

  beforeEach(() => {
    context = buildService();
    acme = context.organizations.seed("ACME");
  });

  describe("given a signing key configured as a server secret", () => {
    describe("when an operator issues a license for a customer organization", () => {
      /** @scenario A license issued from the backoffice is recorded */
      it("records a row linked to the customer with plan, seats, term and issuer", async () => {
        const { license } = await context.service.issue(issueInput(acme));

        expect(context.repository.rows).toHaveLength(1);
        expect(license).toMatchObject({
          organizationId: acme,
          planType: "ENTERPRISE",
          maxMembers: 50,
          expiresAt: NEXT_YEAR,
          issuedById: OPERATOR,
          source: "BACKOFFICE",
          status: "active",
          instanceId: null,
        });
      });

      /** @scenario Issuing a license never asks the operator for the private key */
      it("signs with the server key, so the license verifies against LangWatch's public key", async () => {
        const { licenseKey } = await context.service.issue(issueInput(acme));

        const verdict = validateLicense({
          licenseKey,
          publicKey: langwatchKeys.publicKey,
          now: NOW,
        });
        expect(verdict.valid).toBe(true);
      });

      /** @scenario The registry stores a hash of the token, not the token */
      it("stores the hash of the token and neither the token nor the license", async () => {
        const { licenseKey } = await context.service.issue(issueInput(acme));
        const token = licenseTokenFromKey(licenseKey) as string;
        const stored = JSON.stringify(context.repository.rows[0]);

        expect(context.repository.rows[0]?.tokenHash).toBe(
          registryHashForToken(token),
        );
        expect(stored).not.toContain(token);
        expect(stored).not.toContain(token.slice("lwl_".length));
        expect(stored).not.toContain(licenseKey);
        expect(stored).not.toContain(
          parseLicenseKey(licenseKey)?.signature ?? "missing",
        );
      });

      it("marks the customer organization as a self-hosted customer", async () => {
        await context.service.issue(issueInput(acme));

        expect(
          context.organizations.organizations.get(acme)?.selfHostedCustomer,
        ).toBe(true);
      });
    });

    describe("when an operator issues the first license for a customer that is new", () => {
      /** @scenario A customer organization is marked as a self-hosted customer */
      it("creates the customer organization marked as a self-hosted customer and links the license", async () => {
        const { license } = await context.service.issue({
          ...issueInput(acme),
          customer: { newOrganizationName: "ACME Europe" },
        });

        const created = context.organizations.organizations.get(
          license.organizationId as string,
        );
        expect(created).toMatchObject({
          name: "ACME Europe",
          selfHostedCustomer: true,
        });
      });
    });

    describe("when the customer organization does not exist", () => {
      it("refuses with organization_not_found and writes nothing", async () => {
        await expect(
          context.service.issue(issueInput("org_missing")),
        ).rejects.toMatchObject({ code: "organization_not_found" });
        expect(context.repository.rows).toHaveLength(0);
      });
    });

    describe("when no allowance is set on a license for 52 seats", () => {
      /** @scenario The seat overage allowance defaults to a fifth of the seats, rounded up */
      it("reports an effective allowance of 11", async () => {
        const { license } = await context.service.issue({
          ...issueInput(acme),
          maxMembers: 52,
        });

        expect(license.seatOverageAllowance).toBeNull();
        expect(license.effectiveSeatOverageAllowance).toBe(11);
      });
    });
  });

  describe("given no signing key is configured", () => {
    describe("when an operator issues a license", () => {
      /** @scenario Issuing is refused when no signing key is configured */
      it("refuses with license_signing_not_configured and writes nothing", async () => {
        const unconfigured = buildService({ signing: "unconfigured" });
        const organizationId = unconfigured.organizations.seed("ACME");

        await expect(
          unconfigured.service.issue(issueInput(organizationId)),
        ).rejects.toMatchObject({ code: "license_signing_not_configured" });
        expect(unconfigured.repository.rows).toHaveLength(0);
      });
    });
  });

  describe("given a license LangWatch signed before the registry existed", () => {
    const legacyKey = () =>
      generateLicenseKey({
        organizationName: "ACME",
        email: "ops@acme.test",
        planType: "ENTERPRISE",
        maxMembers: 30,
        privateKey: langwatchKeys.privateKey,
        expiresAt: NEXT_YEAR,
        now: new Date("2026-01-01T00:00:00.000Z"),
      }).licenseKey;

    describe("when an operator pastes it and links it to a customer organization", () => {
      /** @scenario A license issued before the registry existed is registered by pasting it */
      it("verifies the signature and records seats and term read from the license", async () => {
        const license = await context.service.registerLegacy({
          licenseKey: legacyKey(),
          organizationId: acme,
          operatorId: OPERATOR,
        });

        expect(license).toMatchObject({
          organizationId: acme,
          maxMembers: 30,
          expiresAt: NEXT_YEAR,
          source: "LEGACY_IMPORT",
          issuedById: OPERATOR,
        });
        expect(license.issuedAt).toEqual(new Date("2026-01-01T00:00:00.000Z"));
      });
    });

    describe("when the same license is pasted a second time", () => {
      /** @scenario Registering the same license twice is refused */
      it("refuses with license_already_registered and leaves the row unchanged", async () => {
        const licenseKey = legacyKey();
        const first = await context.service.registerLegacy({
          licenseKey,
          organizationId: acme,
          operatorId: OPERATOR,
        });

        await expect(
          context.service.registerLegacy({
            licenseKey: `${licenseKey}\n`,
            organizationId: acme,
            operatorId: "user_other",
          }),
        ).rejects.toMatchObject({ code: "license_already_registered" });
        expect(context.repository.rows).toHaveLength(1);
        expect(context.repository.rows[0]?.issuedById).toBe(first.issuedById);
      });
    });
  });

  describe("given a license whose payload was edited after signing", () => {
    describe("when an operator pastes it", () => {
      /** @scenario A pasted license with a bad signature is refused */
      it("refuses with license_key_invalid and writes nothing", async () => {
        const genuine = generateLicenseKey({
          organizationName: "ACME",
          email: "ops@acme.test",
          planType: "ENTERPRISE",
          maxMembers: 30,
          privateKey: langwatchKeys.privateKey,
          expiresAt: NEXT_YEAR,
          now: NOW,
        }).licenseKey;
        const parsed = parseLicenseKey(genuine);
        const edited = Buffer.from(
          JSON.stringify({
            data: {
              ...parsed?.data,
              plan: { ...parsed?.data.plan, maxMembers: 3000 },
            },
            signature: parsed?.signature,
          }),
        ).toString("base64");

        await expect(
          context.service.registerLegacy({
            licenseKey: edited,
            organizationId: acme,
            operatorId: OPERATOR,
          }),
        ).rejects.toMatchObject({ code: "license_key_invalid" });
        expect(context.repository.rows).toHaveLength(0);
      });
    });

    describe("when the pasted license was signed by someone else", () => {
      it("refuses with license_key_invalid", async () => {
        const forged = generateLicenseKey({
          organizationName: "ACME",
          email: "ops@acme.test",
          planType: "ENTERPRISE",
          maxMembers: 30,
          privateKey: strangerKeys.privateKey,
          expiresAt: NEXT_YEAR,
          now: NOW,
        }).licenseKey;

        await expect(
          context.service.registerLegacy({
            licenseKey: forged,
            organizationId: acme,
            operatorId: OPERATOR,
          }),
        ).rejects.toMatchObject({ code: "license_key_invalid" });
      });
    });
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
          organizations: context.organizations,
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
          organizations: context.organizations,
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
            overageMaxUsdCents: 50_000,
          }),
        ).rejects.toMatchObject({
          code: "license_overage_max_requires_overage",
        });
      });

      it("clears the overage maximum when overage is switched off", async () => {
        await context.service.updateTerms({
          id: licenseId,
          overageEnabled: true,
          overageMaxUsdCents: 50_000,
        });

        const updated = await context.service.updateTerms({
          id: licenseId,
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

  describe("given a license recorded by a flow that names no customer", () => {
    const purchased = () =>
      generateLicenseKey({
        organizationName: "ACME",
        email: "buyer@acme.test",
        planType: "GROWTH",
        maxMembers: 10,
        privateKey: langwatchKeys.privateKey,
        now: NOW,
      }).licenseKey;

    describe("when it is recorded", () => {
      it("is recorded without a customer organization", async () => {
        const license = await context.service.record({
          licenseKey: purchased(),
          source: "PURCHASE",
        });

        expect(license).toMatchObject({
          organizationId: null,
          source: "PURCHASE",
          issuedById: null,
          maxMembers: 10,
        });
      });
    });

    describe("when the mint script records a license it applied to an organization", () => {
      /** @scenario A license minted by the command line script is recorded */
      it("links the row to that organization without calling it a self-hosted customer", async () => {
        const license = await context.service.record({
          licenseKey: purchased(),
          source: "SCRIPT",
          organizationId: acme,
        });

        expect(license).toMatchObject({
          organizationId: acme,
          source: "SCRIPT",
        });
        expect(
          context.organizations.organizations.get(acme)?.selfHostedCustomer,
        ).toBe(false);
      });
    });

    describe("when an operator links it to a customer organization", () => {
      /** @scenario An operator links a recorded license to a customer organization */
      it("links the row and marks the organization as a self-hosted customer", async () => {
        const license = await context.service.record({
          licenseKey: purchased(),
          source: "PURCHASE",
        });

        const linked = await context.service.linkToOrganization({
          id: license.id,
          organizationId: acme,
          operatorId: OPERATOR,
        });

        expect(linked.organizationId).toBe(acme);
        expect(
          context.organizations.organizations.get(acme)?.selfHostedCustomer,
        ).toBe(true);
      });
    });
  });
});
