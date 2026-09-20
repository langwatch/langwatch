/**
 * Licenses another flow signed: the purchase flow, the mint script, and linking them later.
 *
 * Spec: specs/self-hosting/connected-services/license-registry.feature
 */
import { beforeEach, describe, expect, it } from "vitest";
import { generateLicenseKey } from "../../licenseGenerationService";
import {
  buildService,
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
