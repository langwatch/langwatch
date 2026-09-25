/**
 * What a stored provider identifier is called on screen.
 *
 * Two screens got this wrong in opposite directions: the migration screens
 * hardcoded one vendor for everybody, and the directory chip rendered the
 * identifier uppercased, which put the protocol's name in front of a
 * customer. The cases that matter are therefore the one we can spell, the
 * protocol, and the one we have never seen.
 *
 * No scenario annotation: the behaviour these screens are bound on lives in
 * their own component tests. This is the mapping underneath them.
 */
import { describe, expect, it } from "vitest";
import { providerDisplayName } from "../providerDisplayName";

describe("given an identifier we have a spelling for", () => {
  describe("when a screen names it", () => {
    it("uses the vendor's own spelling, not the stored identifier", () => {
      expect(providerDisplayName("auth0")).toBe("Auth0");
      expect(providerDisplayName("okta")).toBe("Okta");
      expect(providerDisplayName("azuread")).toBe("Microsoft Entra ID");
    });

    it("reads the identifier however it happens to be stored", () => {
      expect(providerDisplayName("  Auth0 ")).toBe("Auth0");
      expect(providerDisplayName("OKTA")).toBe("Okta");
    });
  });
});

describe("given an identifier that names a protocol rather than a product", () => {
  describe("when a screen names it", () => {
    it("names nothing, so the caller does not put the protocol on screen", () => {
      // The whole of the "SCIM" chip bug: uppercasing this was the old
      // behaviour, and the label read as an acronym the reader had to guess.
      expect(providerDisplayName("scim")).toBeNull();
      expect(providerDisplayName("saml")).toBeNull();
    });
  });
});

describe("given an identifier we have never seen", () => {
  describe("when a screen names it", () => {
    it("names nothing rather than guessing a vendor", () => {
      expect(providerDisplayName("acme-internal-idp")).toBeNull();
    });

    it("treats an absent identifier the same way", () => {
      expect(providerDisplayName(null)).toBeNull();
      expect(providerDisplayName(undefined)).toBeNull();
      expect(providerDisplayName("")).toBeNull();
    });
  });
});
