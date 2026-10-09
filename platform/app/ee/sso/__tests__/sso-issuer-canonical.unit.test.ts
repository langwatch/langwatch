// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  emptySsoConnection,
  type SsoConnectionState,
} from "@langwatch/identity";
import { describe, expect, it } from "vitest";
import {
  nameIssuerMismatch,
  noteIdTokenIssuerRefusal,
  runWithIdTokenIssuerScope,
} from "~/server/better-auth/id-token-issuer-mismatch";
import { engineProviderFor } from "../sso-engine-provider";
import {
  type SsoIssuerDiscoveryPort,
  validateOidcRegistration,
} from "../sso-idp-registration";
import { plaintextProviderConfigCipher } from "../sso-provider-config";
import { InMemoryCredentials } from "./support/sso-self-serve.fixture";

/**
 * The issuer a connection stores has to be the one its ID tokens carry,
 * character for character (specs/identity/sso-issuer-mismatch.feature).
 */

const TENANT = "8f3c2a8e-1b7d-4c0f-9a51-3e6f2d7b9c10";
const ENTRA = `https://login.microsoftonline.com/${TENANT}/v2.0`;

const discoveryNaming = (issuer?: string): SsoIssuerDiscoveryPort => ({
  async discover() {
    return issuer === undefined
      ? { reachable: true }
      : { reachable: true, issuer };
  },
});

const register = (issuer: string, discovery: SsoIssuerDiscoveryPort) =>
  validateOidcRegistration({
    registration: {
      protocol: "oidc",
      issuer,
      clientId: "client",
      clientSecret: "secret",
    },
    discovery,
  });

const refusalOf = (promise: Promise<unknown>) =>
  promise
    .then(() => ({ code: "no refusal", meta: {} }))
    .catch(
      (error: unknown) =>
        error as { code: string; meta: Record<string, unknown> },
    );

describe("validateOidcRegistration", () => {
  describe("when an Entra ID issuer is typed with a trailing slash", () => {
    /** @scenario "Registration stores the issuer the discovery document names" */
    it("stores the discovery document's issuer, without the slash", async () => {
      expect(await register(`${ENTRA}/`, discoveryNaming(ENTRA))).toEqual({
        issuer: ENTRA,
      });
    });

    it("stores the canonical Entra ID issuer when the document names none", async () => {
      expect(await register(`${ENTRA}//`, discoveryNaming())).toEqual({
        issuer: ENTRA,
      });
    });
  });

  describe("when a provider's issuer ends in a slash", () => {
    it("keeps the slash the discovery document names", async () => {
      const issuer = "https://acme.eu.auth0.com/";
      expect(
        await register("https://acme.eu.auth0.com", discoveryNaming(issuer)),
      ).toEqual({ issuer });
    });
  });

  describe("when the issuer is an Entra ID multi-tenant endpoint", () => {
    /** @scenario "Registration refuses a Microsoft Entra ID multi-tenant issuer" */
    it.each([
      "common",
      "organizations",
      "consumers",
    ])("refuses %s with sso_issuer_multi_tenant", async (segment) => {
      const issuer = `https://login.microsoftonline.com/${segment}/v2.0`;
      const refusal = await refusalOf(
        register(
          issuer,
          discoveryNaming("https://login.microsoftonline.com/{tenantid}/v2.0"),
        ),
      );
      expect(refusal.code).toBe("sso_issuer_multi_tenant");
      expect(refusal.meta).toEqual({ issuer });
    });

    it("refuses a discovery document that names the {tenantid} template", async () => {
      const refusal = await refusalOf(
        register(
          "https://login.microsoftonline.com/acme.example/v2.0",
          discoveryNaming("https://login.microsoftonline.com/{tenantid}/v2.0"),
        ),
      );
      expect(refusal.code).toBe("sso_issuer_multi_tenant");
    });
  });

  describe("when the discovery document names a different issuer", () => {
    /** @scenario "Registration refuses a discovery document that names another issuer" */
    it("refuses with sso_issuer_mismatch naming both issuers", async () => {
      const typed = "https://idp.acme.example/realms/staff";
      const named = "https://idp.acme.example/realms/other";
      const refusal = await refusalOf(register(typed, discoveryNaming(named)));
      expect(refusal.code).toBe("sso_issuer_mismatch");
      expect(refusal.meta).toEqual({ expected: typed, received: named });
    });
  });
});

describe("engineProviderFor", () => {
  describe("when the connection stored an Entra ID issuer with a trailing slash", () => {
    /** @scenario "A Microsoft Entra ID connection stored with a trailing slash signs in after the upgrade" */
    it("writes the engine row with the issuer Entra ID tokens carry", async () => {
      const credentials = new InMemoryCredentials();
      const organizationId = "org_acme";
      const connectionId = "ssoconn_acme";
      const [clientIdRef, secretRef] = await Promise.all([
        credentials.put({
          organizationId,
          connectionId,
          kind: "oidc-client-id",
          value: "client",
        }),
        credentials.put({
          organizationId,
          connectionId,
          kind: "oidc-client-secret",
          value: "secret",
        }),
      ]);
      const connection: SsoConnectionState = {
        ...emptySsoConnection({ connectionId }),
        organizationId,
        type: "oidc",
        state: "ACTIVE",
        idpMetadata: {
          issuer: `${ENTRA}/`,
          providerId: "entra",
          clientIdRef,
          secretRef,
          certRefs: [],
        },
      };

      const row = await engineProviderFor({
        connection,
        credentials,
        baseUrl: "https://langwatch.acme.example",
        providerConfig: plaintextProviderConfigCipher,
      });

      expect(row?.issuer).toBe(ENTRA);
      expect(JSON.parse(row?.oidcConfig ?? "{}").discoveryEndpoint).toBe(
        `${ENTRA}/.well-known/openid-configuration`,
      );
    });
  });
});

describe("nameIssuerMismatch", () => {
  const refusedRedirect = () =>
    new Response(null, {
      status: 302,
      headers: {
        location:
          "/settings/sso?ssoTest=c1&error=invalid_provider&error_description=token_not_verified",
      },
    });
  const issRefusal = (iss: string) =>
    Object.assign(new Error('unexpected "iss" claim value'), {
      code: "ERR_JWT_CLAIM_VALIDATION_FAILED",
      claim: "iss",
      reason: "check_failed",
      payload: { iss, idp: "https://sts.windows.net/home-tenant/" },
    });

  describe("when the engine logged an iss refusal for the request", () => {
    /** @scenario "An ID token from another issuer is refused with both issuers named" */
    it("rewrites the redirect to sso_issuer_mismatch with both issuers", async () => {
      const received = "https://login.microsoftonline.com/home-tenant/v2.0";
      const response = await runWithIdTokenIssuerScope(async () => {
        noteIdTokenIssuerRefusal([issRefusal(received)]);
        return nameIssuerMismatch({
          response: refusedRedirect(),
          expectedIssuer: async () => ENTRA,
        });
      });

      const location = new URL(
        response.headers.get("location") ?? "",
        "https://langwatch.acme.example",
      );
      expect(response.headers.get("location")?.startsWith("/settings")).toBe(
        true,
      );
      expect(location.searchParams.get("error")).toBe("sso_issuer_mismatch");
      expect(location.searchParams.get("received_issuer")).toBe(received);
      expect(location.searchParams.get("expected_issuer")).toBe(ENTRA);
      expect(location.searchParams.get("error_description")).toBeNull();
      expect(location.searchParams.get("ssoTest")).toBe("c1");
    });
  });

  describe("when the refusal was for another claim", () => {
    it("leaves the redirect as it was", async () => {
      const response = await runWithIdTokenIssuerScope(async () => {
        noteIdTokenIssuerRefusal([
          Object.assign(issRefusal(ENTRA), { claim: "aud" }),
        ]);
        return nameIssuerMismatch({
          response: refusedRedirect(),
          expectedIssuer: async () => ENTRA,
        });
      });

      expect(response.headers.get("location")).toContain(
        "error=invalid_provider",
      );
    });
  });

  describe("when nothing was logged outside a request scope", () => {
    it("ignores the log line", () => {
      expect(() => noteIdTokenIssuerRefusal([issRefusal(ENTRA)])).not.toThrow();
    });
  });
});
