/**
 * @vitest-environment node
 * A provider whose token endpoint lives on another origin (Google's layout), through the real
 * transport: trusted when identity names that origin, refused and logged when it does not.
 */
import { sealedProviderConfigCipher } from "@langwatch/identity-contract";
import { memoryAdapter } from "better-auth/adapters/memory";
import type { BetterAuthOptions } from "better-auth/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { openingSsoProviderConfigs } from "../../rules/sso-provider-config.rules.ts";
import { betterAuthTransportFor } from "./better-auth-transport.test-helpers.ts";

const { warned } = vi.hoisted(() => ({ warned: [] as { fields: unknown; message: string }[] }));

vi.mock("@langwatch/observability", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const createLogger = actual.createLogger as (name: string) => Record<string, unknown>;
  return {
    ...actual,
    createLogger: (name: string) => {
      const logger = createLogger(name);
      if (name !== "langwatch:better-auth") return logger;
      return {
        ...logger,
        warn: (fields: unknown, message: string) => warned.push({ fields, message }),
      };
    },
  };
});

const ISSUER = "https://accounts.acme.test";
const TOKEN_ORIGIN = "https://oauth2.acmeapis.test";

const cipher = sealedProviderConfigCipher({
  encrypt: (plaintext) => Buffer.from(plaintext).toString("base64"),
  decrypt: (ciphertext) => Buffer.from(ciphertext, "base64").toString("utf8"),
});

const providerRow = {
  id: "connection_1",
  providerId: "connection_1",
  organizationId: "org_1",
  issuer: ISSUER,
  domain: "acme.test",
  userId: null,
  samlConfig: null,
  oidcConfig: cipher.seal(
    JSON.stringify({
      clientId: "client-1",
      clientSecret: "shhh",
      discoveryEndpoint: `${ISSUER}/.well-known/openid-configuration`,
      pkce: true,
      scopes: ["openid", "email", "profile"],
      mapping: { id: "sub", email: "email", emailVerified: "email_verified" },
    }),
  ),
};

function transportTrusting(endpointOrigins: string[]) {
  const database = {
    user: [],
    session: [],
    account: [],
    verification: [],
    ssoProvider: [providerRow],
  };
  return betterAuthTransportFor(
    {},
    {
      storage: (options: BetterAuthOptions) =>
        openingSsoProviderConfigs({ adapter: memoryAdapter(database)(options), cipher }),
      ssoIssuers: {
        issuersForRequest: async () => [ISSUER],
        endpointOriginsFor: async () => endpointOrigins,
      },
    },
  );
}

const refusalsLogged = () =>
  warned.filter(({ message }) => message === "an sso sign-in was refused");

async function signIn(transport: ReturnType<typeof betterAuthTransportFor>) {
  const response = await transport.handler(
    new Request("https://app.langwatch.test/api/auth/sign-in/sso", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ providerId: "connection_1", callbackURL: "/" }),
    }),
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

beforeEach(() => {
  warned.length = 0;
  vi.stubGlobal("fetch", async () =>
    Response.json({
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}/authorize`,
      token_endpoint: `${TOKEN_ORIGIN}/token`,
      jwks_uri: `${ISSUER}/jwks`,
      response_types_supported: ["code"],
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("given a provider whose token endpoint is on another origin", () => {
  describe("when identity names that origin for the sign-in", () => {
    it("sends the person to the provider", async () => {
      const { status, body } = await signIn(transportTrusting([TOKEN_ORIGIN]));

      expect(status).toBe(200);
      expect(body.url).toContain(`${ISSUER}/authorize`);
      expect(refusalsLogged()).toEqual([]);
    });
  });

  describe("when identity names no endpoint origin", () => {
    /** @scenario "A refused single sign-on start is recorded for whoever runs the installation" */
    it("refuses the sign-in and logs which connection and why", async () => {
      const { status, body } = await signIn(transportTrusting([]));

      expect(status).toBe(400);
      expect(body.code).toBe("discovery_untrusted_origin");
      expect(refusalsLogged()).toEqual([
        {
          fields: expect.objectContaining({
            path: "/api/auth/sign-in/sso",
            code: "discovery_untrusted_origin",
            providerId: "connection_1",
            reason: expect.stringContaining(`${TOKEN_ORIGIN}/token`),
          }),
          message: "an sso sign-in was refused",
        },
      ]);
    });
  });
});
