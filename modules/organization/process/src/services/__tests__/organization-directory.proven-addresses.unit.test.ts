/**
 * @vitest-environment node
 * @see specs/identity/join-before-create.feature
 * The one rule for which addresses a person has proven, read by the join door
 * and the invitation lookup alike.
 */
import { describe, expect, it, vi } from "vitest";

import { OrganizationDirectoryService } from "../organization-directory.service.ts";

function directory({
  identifiers,
  legacy,
}: {
  identifiers: { value: string }[] | null;
  legacy: string | null;
}) {
  const findLegacyVerifiedEmail = vi.fn(async () => legacy);
  const options = {
    identity: {
      verifiedEmailsOf: vi.fn(async () =>
        identifiers === null
          ? { kind: "keep_legacy" as const }
          : { kind: "resolved" as const, emails: identifiers },
      ),
    },
    userDirectory: { findLegacyVerifiedEmail },
  };
  // Partial doubles: the service under test reads only these two members.
  const service = OrganizationDirectoryService.create(options as never);
  return { service, findLegacyVerifiedEmail };
}

describe("OrganizationDirectoryService.findProvenAddresses()", () => {
  describe("when the account is on identifiers", () => {
    /** @scenario A pending invitation is offered before asking to join */
    it("answers every verified identifier and never reads the legacy column", async () => {
      const { service, findLegacyVerifiedEmail } = directory({
        identifiers: [{ value: "sam@acme.com" }, { value: "sam@other.com" }],
        legacy: "stale@acme.com",
      });

      await expect(service.findProvenAddresses({ userId: "user-1" })).resolves.toEqual([
        "sam@acme.com",
        "sam@other.com",
      ]);
      expect(findLegacyVerifiedEmail).not.toHaveBeenCalled();
    });

    /** @scenario An invitation is only offered to somebody who proved the address */
    it("answers nothing for an empty projection rather than falling back", async () => {
      const { service, findLegacyVerifiedEmail } = directory({
        identifiers: [],
        legacy: "sam@acme.com",
      });

      await expect(service.findProvenAddresses({ userId: "user-1" })).resolves.toEqual([]);
      expect(findLegacyVerifiedEmail).not.toHaveBeenCalled();
    });
  });

  describe("when the account is not on identifiers yet", () => {
    /** @scenario An account not yet on identifiers is matched on its verified legacy address */
    it("answers the legacy address where it is verified", async () => {
      const { service } = directory({ identifiers: null, legacy: "sam@acme.com" });

      await expect(service.findProvenAddresses({ userId: "user-1" })).resolves.toEqual([
        "sam@acme.com",
      ]);
    });

    /** @scenario An invitation is only offered to somebody who proved the address */
    it("answers nothing where the legacy address is not verified", async () => {
      const { service } = directory({ identifiers: null, legacy: null });

      await expect(service.findProvenAddresses({ userId: "user-1" })).resolves.toEqual([]);
    });
  });
});
