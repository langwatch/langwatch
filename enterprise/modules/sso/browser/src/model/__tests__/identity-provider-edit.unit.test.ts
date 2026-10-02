// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Which connections offer the identity provider edit, and the form it opens
 * on. Spec: specs/identity/sso-connection-edit-identity-provider.feature.
 */
import { describe, expect, it } from "vitest";

import {
  identityProviderFormFrom,
  identityProviderIsEditable,
  identityProviderUpdateFromForm,
} from "../identity-provider-edit.ts";

describe("whether a connection offers the identity provider edit", () => {
  describe("when an administrator reads a self-serve connection being set up or live", () => {
    it.each(["DRAFT", "VERIFIED", "ACTIVE", "SUSPENDED"] as const)("offers it in %s", (state) => {
      expect(
        identityProviderIsEditable({
          canManage: true,
          connection: { source: "self-serve", state },
        }),
      ).toBe(true);
    });
  });

  describe("when the connection is on its way out or gone", () => {
    it.each(["TEARDOWN_PENDING", "DISCARDED", "TORN_DOWN"] as const)(
      "does not offer it in %s",
      (state) => {
        expect(
          identityProviderIsEditable({
            canManage: true,
            connection: { source: "self-serve", state },
          }),
        ).toBe(false);
      },
    );
  });

  describe("when the connection is grandfathered", () => {
    it("does not offer it, since it has no settings of its own", () => {
      expect(
        identityProviderIsEditable({
          canManage: true,
          connection: { source: "legacy-grandfathered", state: "ACTIVE" },
        }),
      ).toBe(false);
    });
  });

  describe("when the reader may only look", () => {
    it("does not offer it", () => {
      expect(
        identityProviderIsEditable({
          canManage: false,
          connection: { source: "self-serve", state: "ACTIVE" },
        }),
      ).toBe(false);
    });
  });
});

describe("the edit form", () => {
  describe("given an OpenID Connect connection", () => {
    /** @scenario "The settings card offers the edit prefilled with the current settings" */
    it("opens on the issuer and client id with the secret blank", () => {
      const form = identityProviderFormFrom({
        protocol: "oidc",
        issuer: "https://login.microsoftonline.com/wrong-tenant/v2.0",
        clientId: "client_old",
        hasClientSecret: true,
      });

      expect(form.issuer).toBe("https://login.microsoftonline.com/wrong-tenant/v2.0");
      expect(form.clientId).toBe("client_old");
      expect(form.clientSecret).toBe("");
    });

    describe("when the secret is left blank", () => {
      it("sends null, which keeps the stored secret", () => {
        const form = identityProviderFormFrom({
          protocol: "oidc",
          issuer: "https://sso.acme.example",
          clientId: "client",
          hasClientSecret: true,
        });

        expect(identityProviderUpdateFromForm({ protocol: "oidc", form })).toEqual({
          protocol: "oidc",
          issuer: "https://sso.acme.example",
          clientId: "client",
          clientSecret: null,
        });
      });
    });
  });

  describe("given a SAML connection", () => {
    it("opens on the SAML settings and sends empty boxes as null", () => {
      const form = identityProviderFormFrom({
        protocol: "saml",
        entryPoint: "https://login.acme.example/sso",
        entityId: null,
        metadataXml: null,
        certificate: "MIIC",
      });

      expect(identityProviderUpdateFromForm({ protocol: "saml", form })).toEqual({
        protocol: "saml",
        entryPoint: "https://login.acme.example/sso",
        entityId: null,
        metadataXml: null,
        certificate: "MIIC",
      });
    });
  });
});
