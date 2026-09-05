import { describe, expect, it } from "vitest";
import { authenticatorName, passkeyLabel } from "../passkeyAuthenticators";

/**
 * Naming a passkey by what made it.
 *
 * Spec: specs/identity/passkeys.feature
 */
describe("given a passkey to name", () => {
  describe("when somebody has renamed it", () => {
    it("keeps the name they chose", () => {
      expect(
        passkeyLabel({
          name: "Work laptop",
          aaguid: "bada5566-a7aa-401f-bd96-45619a55120d",
        }),
      ).toBe("Work laptop");
    });
  });

  describe("when the name is only the address the ceremony had", () => {
    it("names the authenticator instead of repeating the address", () => {
      // Three passkeys registered from the sign-up screen all carry the same
      // string, which is why a list of them tells the reader nothing.
      expect(
        passkeyLabel({
          name: "alex+bunj@langwatch.ai",
          aaguid: "fbfc3007-154e-4ecc-8c0b-6e020557d7bd",
        }),
      ).toBe("iCloud Keychain");
    });

    it("keeps the address rather than inventing one when nothing is recognised", () => {
      // Better a string somebody recognises as theirs than the bare word.
      expect(passkeyLabel({ name: "alex@langwatch.ai", aaguid: null })).toBe(
        "alex@langwatch.ai",
      );
    });
  });

  describe("when it carries no name at all", () => {
    it("names the authenticator", () => {
      expect(
        passkeyLabel({ aaguid: "cb69481e-8ff7-4039-93ec-0a2729a154a8" }),
      ).toBe("YubiKey 5");
    });

    it("falls back to the plain word when the authenticator is unknown", () => {
      expect(passkeyLabel({ aaguid: "not-in-the-registry" })).toBe("Passkey");
      expect(passkeyLabel({})).toBe("Passkey");
    });
  });
});

describe("given an authenticator identifier", () => {
  describe("when the hex arrives upper-cased", () => {
    it("recognises it anyway", () => {
      // Implementations differ on case, and a map matching one of them would
      // silently answer nothing for half the population.
      expect(authenticatorName("FBFC3007-154E-4ECC-8C0B-6E020557D7BD")).toBe(
        "iCloud Keychain",
      );
    });
  });

  describe("when the authenticator declines to identify its model", () => {
    it("reads the all-zero identifier as no answer", () => {
      expect(
        authenticatorName("00000000-0000-0000-0000-000000000000"),
      ).toBeNull();
    });
  });

  describe("when there is no identifier at all", () => {
    it("answers nothing rather than guessing", () => {
      expect(authenticatorName(null)).toBeNull();
      expect(authenticatorName(undefined)).toBeNull();
      expect(authenticatorName("  ")).toBeNull();
    });
  });
});
