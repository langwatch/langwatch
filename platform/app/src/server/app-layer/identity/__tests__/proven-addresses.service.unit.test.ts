/** @vitest-environment node */

import { describe, expect, it, vi } from "vitest";
import { ProvenAddressesService } from "../proven-addresses.service";

/**
 * The one rule for which addresses a person has proven, read by the join
 * door and the invitation lookup alike.
 *
 * Spec: specs/identity/join-before-create.feature
 */
describe("ProvenAddressesService.addressesOf()", () => {
  function service({
    identifiers,
    legacy,
  }: {
    identifiers: { value: string }[] | null;
    legacy: string | null;
  }) {
    const verifiedEmailsOf = vi.fn().mockResolvedValue(identifiers);
    const findVerifiedLegacyEmail = vi.fn().mockResolvedValue(legacy);
    return {
      service: new ProvenAddressesService({
        verifiedEmailsOf,
        findVerifiedLegacyEmail,
      }),
      findVerifiedLegacyEmail,
    };
  }

  describe("when the account is on identifiers", () => {
    /** @scenario A pending invitation is offered before asking to join */
    it("answers every verified identifier and never reads the legacy column", async () => {
      const { service: s, findVerifiedLegacyEmail } = service({
        identifiers: [{ value: "sam@acme.com" }, { value: "sam@other.com" }],
        legacy: "stale@acme.com",
      });

      await expect(s.addressesOf({ userId: "user-1" })).resolves.toEqual([
        "sam@acme.com",
        "sam@other.com",
      ]);
      expect(findVerifiedLegacyEmail).not.toHaveBeenCalled();
    });

    /** @scenario An invitation is only offered to somebody who proved the address */
    it("answers nothing for an empty projection rather than falling back", async () => {
      const { service: s, findVerifiedLegacyEmail } = service({
        identifiers: [],
        legacy: "sam@acme.com",
      });

      await expect(s.addressesOf({ userId: "user-1" })).resolves.toEqual([]);
      expect(findVerifiedLegacyEmail).not.toHaveBeenCalled();
    });
  });

  describe("when the account is not on identifiers yet", () => {
    /** @scenario An account not yet on identifiers is matched on its verified legacy address */
    it("answers the legacy address where it is verified", async () => {
      const { service: s, findVerifiedLegacyEmail } = service({
        identifiers: null,
        legacy: "sam@acme.com",
      });

      await expect(s.addressesOf({ userId: "user-1" })).resolves.toEqual([
        "sam@acme.com",
      ]);
      expect(findVerifiedLegacyEmail).toHaveBeenCalledWith({
        userId: "user-1",
      });
    });

    /** @scenario An invitation is only offered to somebody who proved the address */
    it("answers nothing where the legacy address is not verified", async () => {
      const { service: s } = service({ identifiers: null, legacy: null });

      await expect(s.addressesOf({ userId: "user-1" })).resolves.toEqual([]);
    });
  });
});
