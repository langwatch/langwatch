import { describe, expect, it } from "vitest";
import { identifierDomain, normalizeIdentifierValue } from "../identifier";
import {
  arrivalStateForProvider,
  identifierProviderFor,
  isLiveIdentifierState,
} from "../vocabulary";

describe("identifier normalization", () => {
  describe("when a raw email value arrives from a ceremony", () => {
    it("folds case and trims, and keeps the plus tag it was given", () => {
      expect(normalizeIdentifierValue("  Sam.J+work@Acme.COM ")).toBe(
        "sam.j+work@acme.com",
      );
    });

    it("holds a tagged address apart from the one it is tagged from", () => {
      // Two addresses, two identifiers. The person chose the tag to keep this
      // account separable, and their provider routes the two separately.
      const tagged = normalizeIdentifierValue("sam+work@acme.com");

      expect(tagged).not.toBe(normalizeIdentifierValue("sam@acme.com"));
      // The DOMAIN is unchanged, which is what routing reads: a tagged
      // address still reaches its organization's connection.
      expect(identifierDomain(tagged)).toBe("acme.com");
    });

    it("keeps a value that is not email-shaped as a folded string", () => {
      expect(normalizeIdentifierValue(" GID-123 ")).toBe("gid-123");
      expect(identifierDomain("gid-123")).toBeNull();
    });

    it("reads the domain off an email-shaped value only", () => {
      expect(identifierDomain("sam@acme.com")).toBe("acme.com");
      expect(identifierDomain("sam@")).toBeNull();
    });
  });
});

describe("provider vocabulary", () => {
  it("maps better-auth providerIds into the identifier vocabulary", () => {
    expect(identifierProviderFor("credential")).toBe("credential");
    expect(identifierProviderFor("google")).toBe("google");
    expect(identifierProviderFor("microsoft")).toBe("azure-ad");
    expect(identifierProviderFor("auth0")).toBe("oidc");
    expect(identifierProviderFor("okta")).toBe("oidc");
  });

  it("arrives email ATTACHED and every other provider VERIFIED", () => {
    expect(arrivalStateForProvider("email")).toBe("ATTACHED");
    expect(arrivalStateForProvider("google")).toBe("VERIFIED");
    expect(arrivalStateForProvider("credential")).toBe("VERIFIED");
  });

  it("counts ATTACHED, VERIFIED and PRIMARY as live, tombstones as not", () => {
    expect(isLiveIdentifierState("ATTACHED")).toBe(true);
    expect(isLiveIdentifierState("PRIMARY")).toBe(true);
    expect(isLiveIdentifierState("DETACHED")).toBe(false);
    expect(isLiveIdentifierState("DEAD_END")).toBe(false);
  });
});
