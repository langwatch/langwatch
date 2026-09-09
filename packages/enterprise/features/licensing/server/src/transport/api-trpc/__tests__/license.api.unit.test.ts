/**
 * The `license.*` tRPC surface: getStatus and upload, over a real `LicensingApp` with a faked
 * license service.
 * @see specs/licensing/license-router.feature
 */
import { initTRPC } from "@trpc/server";
import { describe, expect, it } from "vitest";

import { LicenseTrpcApi, type LicenseTrpcContext } from "../license.api.ts";
import { createTestLicensingApp, EXPIRED_LICENSE_KEY } from "../../../testing.ts";

const trpc = initTRPC.context<LicenseTrpcContext>().create();

const identityPolicy = <TProcedure>(procedure: TProcedure): TProcedure => procedure;

const router = LicenseTrpcApi.create(trpc, {
  protected: trpc.procedure,
  policy: () => identityPolicy,
  unscopedPolicy: identityPolicy,
  validateOutput: true,
});

function makeCaller() {
  const licensing = createTestLicensingApp();
  return router.createCaller({
    app: { licensing },
    actor: () => ({ id: "user-123" }),
  });
}

describe("given an organization with no license", () => {
  describe("when license.getStatus is called", () => {
    /** @scenario "Gets license status for organization without license" */
    it("answers hasLicense and valid both false", async () => {
      const caller = makeCaller();

      const status = await caller.getStatus({ organizationId: "org-456" });

      expect(status).toEqual({ hasLicense: false, valid: false });
    });
  });
});

describe("given a license key past its expiry date", () => {
  describe("when license.upload is called with it", () => {
    /** @scenario "Returns error for expired license" */
    it("refuses with the expired-license code at 400", async () => {
      const caller = makeCaller();

      await expect(
        caller.upload({ organizationId: "org-456", licenseKey: EXPIRED_LICENSE_KEY }),
      ).rejects.toMatchObject({ cause: { code: "license_expired", httpStatus: 400 } });
    });
  });
});
