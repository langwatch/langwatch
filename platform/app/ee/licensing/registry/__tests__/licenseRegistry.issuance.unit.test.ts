/**
 * Signing and recording a license: what the registry will and will not write.
 *
 * Spec: specs/self-hosting/connected-services/license-registry.feature
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateLicenseKey } from "../../licenseGenerationService";
import { licenseTokenFromKey, registryHashForToken } from "../../licenseToken";
import { parseLicenseKey, validateLicense } from "../../validation";
import {
  buildService,
  issueInput,
  langwatchKeys,
  NEXT_YEAR,
  NOW,
  OPERATOR,
  strangerKeys,
} from "./support/registryHarness";

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
  });

  describe("given marking the customer as a self-hosted customer fails", () => {
    describe("when an operator issues a license", () => {
      /** @scenario A license is written only once its customer is marked */
      it("writes no row, so issuing again is not refused as a duplicate", async () => {
        vi.spyOn(
          context.organizations,
          "markSelfHostedCustomer",
        ).mockRejectedValueOnce(new Error("the organization is unreachable"));

        await expect(context.service.issue(issueInput(acme))).rejects.toThrow(
          "the organization is unreachable",
        );

        expect(context.repository.rows).toHaveLength(0);
        await expect(
          context.service.issue(issueInput(acme)),
        ).resolves.toMatchObject({ license: { organizationId: acme } });
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

    describe("when two writes of the same license key race past the check", () => {
      /** @scenario The same license written twice at once is still refused by name */
      it("refuses the one the table rejects as license_already_registered", async () => {
        const licenseKey = legacyKey();
        await context.service.registerLegacy({
          licenseKey,
          organizationId: acme,
          operatorId: OPERATOR,
        });
        // What the other write saw: the row was not there yet when it looked.
        vi.spyOn(context.repository, "findByTokenHash").mockResolvedValue(null);

        await expect(
          context.service.registerLegacy({
            licenseKey,
            organizationId: acme,
            operatorId: "user_other",
          }),
        ).rejects.toMatchObject({ code: "license_already_registered" });
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
});
