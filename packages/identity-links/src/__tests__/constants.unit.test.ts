import { describe, expect, it } from "vitest";

import {
  ACTOR_ID_KIND_BY_PROVIDER,
  canonicalizeEmailLike,
  canonicalizeExternalId,
  EMAIL_EXTERNAL_KINDS,
  emailKindsForProvider,
  EXTERNAL_KINDS_BY_PROVIDER,
  isEmailKind,
} from "../constants";

describe("EMAIL_EXTERNAL_KINDS", () => {
  // ADR-094 Decision 9 (amended v7): erasure must swap every kind whose value
  // is the person's address — `email`, and Microsoft's email-shaped `upn`.
  it("covers email and upn, nothing else", () => {
    expect([...EMAIL_EXTERNAL_KINDS].sort()).toEqual(["email", "upn"]);
  });

  it("every email kind is a declared provider kind", () => {
    const declared = new Set(
      Object.values(EXTERNAL_KINDS_BY_PROVIDER).flat() as string[],
    );
    for (const kind of EMAIL_EXTERNAL_KINDS) {
      expect(declared).toContain(kind);
    }
  });

  it("isEmailKind matches the list", () => {
    expect(isEmailKind("email")).toBe(true);
    expect(isEmailKind("upn")).toBe(true);
    expect(isEmailKind("entra_object_id")).toBe(false);
    expect(isEmailKind("numeric_id")).toBe(false);
  });
});

describe("canonicalizeEmailLike (ADR-094 Constants, erased-email token)", () => {
  it("trims and lowercases, so one address is one timeline entry", () => {
    expect(canonicalizeEmailLike("  Alice@Example.COM ")).toBe(
      "alice@example.com",
    );
  });

  it("is idempotent — canonicalizing twice changes nothing", () => {
    const once = canonicalizeEmailLike(" Bob@Example.com ");
    expect(canonicalizeEmailLike(once)).toBe(once);
  });

  describe("when the kind is not email-shaped", () => {
    // Lowercasing an opaque id is a corruption, not a normalization: a
    // Databricks numeric id or an Entra objectId is case-significant.
    it("leaves the value exactly as the provider spelled it", () => {
      expect(
        canonicalizeExternalId({
          externalKind: "entra_object_id",
          externalId: "AB12-Cd34",
        }),
      ).toBe("AB12-Cd34");
    });
  });

  describe("when the kind is email-shaped", () => {
    it("canonicalizes both email and upn", () => {
      expect(
        canonicalizeExternalId({
          externalKind: "email",
          externalId: " Alice@Example.com",
        }),
      ).toBe("alice@example.com");
      expect(
        canonicalizeExternalId({
          externalKind: "upn",
          externalId: "Alice@Contoso.OnMicrosoft.com ",
        }),
      ).toBe("alice@contoso.onmicrosoft.com");
    });
  });
});

describe("ACTOR_ID_KIND_BY_PROVIDER (ADR-094 Decision 1)", () => {
  // A kind here that no provider declares is a join that silently never
  // matches — no error, just a report that attributes nothing.
  it("names a kind the provider actually declares", () => {
    for (const [provider, kind] of Object.entries(ACTOR_ID_KIND_BY_PROVIDER)) {
      const declared = EXTERNAL_KINDS_BY_PROVIDER[
        provider as keyof typeof EXTERNAL_KINDS_BY_PROVIDER
      ] as readonly string[];
      expect(declared).toContain(kind);
    }
  });

  it("never points the typed id at an email kind", () => {
    // The typed id exists precisely so the report does not have to join on an
    // address: emails get recycled, which is the failure the ADR refuses.
    for (const kind of Object.values(ACTOR_ID_KIND_BY_PROVIDER)) {
      expect(isEmailKind(kind)).toBe(false);
    }
  });
});

describe("emailKindsForProvider", () => {
  it("derives each provider's own spelling of an address", () => {
    expect(emailKindsForProvider("anthropic")).toEqual(["email"]);
    expect(emailKindsForProvider("databricks")).toEqual(["email"]);
    // Microsoft spells it `upn` and declares no `email` kind at all.
    expect(emailKindsForProvider("microsoft")).toEqual(["upn"]);
  });

  describe("when the provider is not declared", () => {
    // OpenAI has no declared id namespace yet (its puller writes no actor_id
    // on purpose), so it contributes no refs and its rows land unattributed.
    it("returns nothing rather than throwing", () => {
      expect(emailKindsForProvider("openai")).toEqual([]);
    });
  });
});
