/**
 * Changing the seats of a running license from the backoffice: the
 * replacement, the term it keeps, and what billing is told.
 *
 * @see ../licenseRegistry.service.ts
 * @see specs/self-hosting/connected-services/license-registry.feature
 */

import { beforeEach, describe, expect, it } from "vitest";
import { parseLicenseKey } from "../../validation";
import {
  buildService,
  issueInput,
  NEXT_YEAR,
  OPERATOR,
} from "./support/registryHarness";

describe("changing the seats of a license", () => {
  let context: ReturnType<typeof buildService>;
  let acme: string;
  let licenseId: string;

  beforeEach(async () => {
    context = buildService();
    acme = context.organizations.seed("ACME");
    const { license } = await context.service.issue(issueInput(acme));
    licenseId = license.id;
  });

  describe("given an active license for 50 seats", () => {
    describe("when an operator raises it to 58 seats", () => {
      /** @scenario An operator changes the seats of a running license */
      it("signs a replacement for the same term and has the added seats invoiced", async () => {
        const result = await context.service.changeSeats({
          id: licenseId,
          maxMembers: 58,
          operatorId: OPERATOR,
        });

        expect(result.previousMaxMembers).toBe(50);
        expect(result.billing).toBe("invoiced");
        expect(result.license).toMatchObject({
          maxMembers: 58,
          replacesId: licenseId,
          expiresAt: NEXT_YEAR,
          hasPendingDelivery: true,
        });
        expect(parseLicenseKey(result.licenseKey)?.data.plan.maxMembers).toBe(
          58,
        );
        expect(context.seatBilling.invoiced).toEqual([
          {
            organizationId: acme,
            licenseRowId: result.license.id,
            previousSeats: 50,
            seats: 58,
            operatorId: OPERATOR,
          },
        ]);
      });
    });

    describe("when an operator lowers it to 40 seats", () => {
      /** @scenario Seats that went down are not credited back mid-term */
      it("signs the replacement and asks billing for nothing", async () => {
        const result = await context.service.changeSeats({
          id: licenseId,
          maxMembers: 40,
          operatorId: OPERATOR,
        });

        expect(result.license.maxMembers).toBe(40);
        expect(result.billing).toBe("nothing_to_invoice");
        expect(context.seatBilling.invoiced).toEqual([]);
      });
    });

    describe("when the seats were already changed once", () => {
      it("refuses a second change on the replaced license", async () => {
        await context.service.changeSeats({
          id: licenseId,
          maxMembers: 58,
          operatorId: OPERATOR,
        });

        await expect(
          context.service.changeSeats({
            id: licenseId,
            maxMembers: 60,
            operatorId: OPERATOR,
          }),
        ).rejects.toMatchObject({ code: "license_already_reissued" });
      });
    });
  });

  describe("given a revoked license", () => {
    /** @scenario Seats changed on a revoked license are refused */
    it("refuses to change its seats", async () => {
      await context.service.revoke({
        id: licenseId,
        operatorId: OPERATOR,
        reason: "leaked",
      });

      await expect(
        context.service.changeSeats({
          id: licenseId,
          maxMembers: 58,
          operatorId: OPERATOR,
        }),
      ).rejects.toMatchObject({ code: "issued_license_not_active" });
      expect(context.seatBilling.invoiced).toEqual([]);
    });
  });
});
