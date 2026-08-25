import { describe, expect, it } from "vitest";
import { identifierDomain, normalizeIdentifierValue } from "../identifier";
import {
  arrivalStateForProvider,
  identifierProviderFor,
  isLiveIdentifierState,
} from "../vocabulary";

describe("identifier normalization", () => {
  describe("when a raw email value arrives from a ceremony", () => {
    it("folds case, trims, and strips the plus tag from the local part", () => {
      expect(normalizeIdentifierValue("  Sam.J+work@Acme.COM ")).toBe(
        "sam.j@acme.com",
      );
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
