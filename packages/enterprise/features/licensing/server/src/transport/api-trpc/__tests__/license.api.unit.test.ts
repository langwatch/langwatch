/**
 * The `license.*` tRPC surface: getStatus and upload, over a real `LicensingApp` with a faked
 * license service.
 * @see specs/licensing/license-router.feature
 */
import { initTRPC } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";

import { LicensingApp } from "../../../app/licensing.app";
import { LicenseTrpcApi, type LicenseTrpcContext } from "../license.api";

const trpc = initTRPC.context<LicenseTrpcContext>().create();

const identityPolicy = <TProcedure>(procedure: TProcedure): TProcedure => procedure;

const router = LicenseTrpcApi.create(trpc, {
  protected: trpc.procedure,
  policy: () => identityPolicy,
  unscopedPolicy: identityPolicy,
});

const refuses = (name: string) => () => {
  throw new Error(`the license router surface does not read ${name}`);
};

function makeCaller(overrides: {
  getLicenseStatus?: (organizationId: string) => unknown;
  validateAndStoreLicense?: (input: {
    organizationId: string;
    licenseKey: string;
  }) => Promise<unknown>;
}) {
  const licensing = LicensingApp.create({
    licenses: () =>
      ({
        getLicenseStatus: overrides.getLicenseStatus ?? (refuses("getLicenseStatus") as never),
        validateAndStoreLicense:
          overrides.validateAndStoreLicense ?? (refuses("validateAndStoreLicense") as never),
      }) as never,
    cryptography: refuses("cryptography"),
    configuredAuthProvider: refuses("the auth provider"),
    platformSsoAllowed: refuses("the single sign-on gate"),
    authProviderIsMounted: refuses("the auth provider"),
    reportSigningFailure: refuses("signing failures"),
    reportError: vi.fn(),
  } as never);

  return router.createCaller({
    app: { licensing },
    actor: () => ({ id: "user-123" }),
  });
}

describe("given an organization with no license", () => {
  describe("when license.getStatus is called", () => {
    /** @scenario "Gets license status for organization without license" */
    it("answers hasLicense and valid both false", async () => {
      const caller = makeCaller({
        getLicenseStatus: async () => ({ hasLicense: false, valid: false }),
      });

      const status = await caller.getStatus({ organizationId: "org-456" });

      expect(status).toEqual({ hasLicense: false, valid: false });
    });
  });
});

describe("given a license key past its expiry date", () => {
  describe("when license.upload is called with it", () => {
    /** @scenario "Returns error for expired license" */
    it("refuses with the expired-license code at 400", async () => {
      const caller = makeCaller({
        validateAndStoreLicense: async () => ({
          success: false,
          error: "License expired",
        }),
      });

      await expect(
        caller.upload({ organizationId: "org-456", licenseKey: "expired-license" }),
      ).rejects.toMatchObject({ cause: { code: "license_expired", httpStatus: 400 } });
    });
  });
});
