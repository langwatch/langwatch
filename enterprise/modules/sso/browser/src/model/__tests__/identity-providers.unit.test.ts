// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { describe, expect, it } from "vitest";

import {
  consolePathFor,
  IDENTITY_PROVIDER_PRESETS,
  identityProviderPreset,
  identityProvidersIn,
} from "../identity-providers.ts";

describe("the providers an administrator picks from", () => {
  it("answers the reader who knows their product and the one who knows their protocol", () => {
    expect(identityProvidersIn("product").map((preset) => preset.id)).toContain("okta");
    expect(identityProvidersIn("protocol").map((preset) => preset.id)).toEqual([
      "oidc",
      "saml",
      "other",
    ]);
  });

  it("leaves a protocol tile nothing further to ask, and a product tile the question", () => {
    expect(identityProviderPreset("oidc").protocolIsChosen).toBe(true);
    expect(identityProviderPreset("okta").protocolIsChosen).toBe(false);
    // "Something else" is a product nobody listed, so the protocol is still open.
    expect(identityProviderPreset("other").protocolIsChosen).toBe(false);
  });

  it("gives every preset the shapes its own addresses take", () => {
    for (const preset of IDENTITY_PROVIDER_PRESETS) {
      expect(preset.issuerExample.length).toBeGreaterThan(0);
      expect(preset.entryPointExample.length).toBeGreaterThan(0);
      expect(preset.monogram.length).toBeGreaterThan(0);
    }
  });

  it("refuses a tile nobody listed rather than answering for it", () => {
    expect(() => identityProviderPreset("ping")).toThrow(/unknown identity provider preset/);
  });
});

describe("where the application is created in the provider's console", () => {
  describe("when Microsoft Entra ID is set up over OpenID Connect", () => {
    /** @scenario "The registration form says where Microsoft Entra ID shows its issuer" */
    it("points at App registrations", () => {
      expect(consolePathFor({ preset: identityProviderPreset("entra"), protocol: "oidc" })).toBe(
        "App registrations → New registration",
      );
    });
  });

  describe("when Microsoft Entra ID is set up over SAML", () => {
    it("points at Enterprise applications", () => {
      expect(consolePathFor({ preset: identityProviderPreset("entra"), protocol: "saml" })).toBe(
        "Enterprise applications → New application",
      );
    });
  });

  describe("when the provider keeps both protocols in one place", () => {
    it("points at the same path for either", () => {
      const okta = identityProviderPreset("okta");

      expect(consolePathFor({ preset: okta, protocol: "saml" })).toBe(okta.consolePath);
    });
  });
});
