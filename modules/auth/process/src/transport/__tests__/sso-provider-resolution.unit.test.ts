/**
 * The door reaches a provider (D09). Identity folds one row per dialable
 * connection and seals its dialing document; this is the other half — the
 * engine finding that row by the address somebody typed, and reading the
 * document back through the deployment's own cipher.
 */
import { sealedProviderConfigCipher } from "@langwatch/identity-contract";
import { memoryAdapter } from "better-auth/adapters/memory";
import type { BetterAuthOptions } from "better-auth/types";
import { describe, expect, it } from "vitest";

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

function transportOver({ rows, opening }: { rows: unknown[]; opening: boolean }) {
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
    },
  );
}

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
    body: (await response.json()) as { message?: string; code?: string },
  };
};

describe("given identity folded a provider row for a proved domain", () => {
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
