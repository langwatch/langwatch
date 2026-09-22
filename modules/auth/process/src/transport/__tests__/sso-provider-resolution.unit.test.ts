/**
 * The door reaches a provider (D09). Identity seals one dialing document per
 * dialable connection; this is the other half — the engine finding that row
 * by the address typed, and reading it back through the deployment's cipher.
 */
import { sealedProviderConfigCipher } from "@langwatch/identity-contract";
import { memoryAdapter } from "better-auth/adapters/memory";
import type { BetterAuthOptions } from "better-auth/types";
import { afterEach, describe, expect, it, vi } from "vitest";

import { openingSsoProviderConfigs } from "../../rules/sso-provider-config.rules.ts";
import { betterAuthTransportFor } from "./better-auth-transport.test-helpers.ts";

const cipher = sealedProviderConfigCipher({
  encrypt: (plaintext) => Buffer.from(plaintext).toString("base64"),
  decrypt: (ciphertext) => Buffer.from(ciphertext, "base64").toString("utf8"),
});

/** The row identity's derivation writes for an OIDC connection. */
const providerRow = (overrides: Record<string, unknown> = {}) => ({
  id: "connection_1",
  providerId: "connection_1",
  organizationId: "org_1",
  issuer: "https://idp.acme.test",
  domain: "acme.test",
  userId: null,
  samlConfig: null,
  oidcConfig: cipher.seal(
    JSON.stringify({
      clientId: "client-1",
      clientSecret: "shhh",
      discoveryEndpoint: "https://idp.acme.test/.well-known/openid-configuration",
      pkce: true,
      scopes: ["openid", "email", "profile"],
      mapping: { id: "sub", email: "email", emailVerified: "email_verified" },
    }),
  ),
  ...overrides,
});

function transportOver({
  rows,
  opening,
  registeredIssuers = [],
}: {
  rows: unknown[];
  opening: boolean;
  /** What identity answers this request — an administrator having registered
   *  an issuer is what makes its origin one we may fetch from. */
  registeredIssuers?: string[];
}) {
  const database = { user: [], session: [], account: [], verification: [], ssoProvider: rows };
  return betterAuthTransportFor(
    {},
    {
      storage: {
        adapter: () => (options: BetterAuthOptions) => {
          const engine = memoryAdapter(database as never)(options);
          return opening ? openingSsoProviderConfigs({ adapter: engine, cipher }) : engine;
        },
      } as never,
      ssoIssuers: { issuersForRequest: async () => registeredIssuers },
    },
  );
}

/** The identity provider's own discovery document, so nothing dials out. */
function stubDiscovery(): void {
  vi.stubGlobal("fetch", async (input: string | URL | Request) => {
    const url = input instanceof Request ? input.url : input.toString();
    if (!url.startsWith("https://idp.acme.test/")) {
      throw new Error(`nothing may be fetched from ${url}`);
    }
    return Response.json({
      issuer: "https://idp.acme.test",
      authorization_endpoint: "https://idp.acme.test/authorize",
      token_endpoint: "https://idp.acme.test/token",
      jwks_uri: "https://idp.acme.test/jwks",
      userinfo_endpoint: "https://idp.acme.test/userinfo",
      response_types_supported: ["code"],
    });
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const signInThroughSso = async (
  transport: ReturnType<typeof betterAuthTransportFor>,
  body: Record<string, unknown>,
) => {
  const response = await transport.handler(
    new Request("https://app.langwatch.test/api/auth/sign-in/sso", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  return {
    status: response.status,
    body: (await response.json()) as { message?: string; code?: string; url?: string },
  };
};

describe("given identity folded a provider row for a proved domain", () => {
  /** @scenario "An issuer nobody registered is refused by name" */
  it("reads the sealed dialing document back and asks that provider", async () => {
    const { status, body } = await signInThroughSso(
      transportOver({ rows: [providerRow()], opening: true }),
      { email: "person@acme.test", callbackURL: "/" },
    );

    // Not 404 "No provider found for the issuer" any more, and the address it
    // now names came out of the document identity sealed.
    expect(status).toBe(400);
    expect(body.code).toBe("discovery_untrusted_origin");
    expect(body.message).toContain("https://idp.acme.test/.well-known/openid-configuration");
  });

  /** @scenario "An issuer a customer registered is one this installation may fetch from" */
  it("sends the customer to their own provider once its issuer is registered", async () => {
    stubDiscovery();

    const { status, body } = await signInThroughSso(
      transportOver({
        rows: [providerRow()],
        opening: true,
        registeredIssuers: ["https://idp.acme.test"],
      }),
      { email: "person@acme.test", callbackURL: "/" },
    );

    // The registration IS the declaration that this installation may talk to
    // that address: no static list could have contained it.
    expect(status).toBe(200);
    expect(body.url).toContain("https://idp.acme.test/authorize");
  });

  it("cannot dial a sealed row where nothing opens it", async () => {
    const response = await transportOver({ rows: [providerRow()], opening: false }).handler(
      new Request("https://app.langwatch.test/api/auth/sign-in/sso", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "person@acme.test", callbackURL: "/" }),
      }),
    );

    expect(response.status).toBe(500);
  });
});
