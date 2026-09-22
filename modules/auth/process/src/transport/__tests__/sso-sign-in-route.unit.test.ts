/**
 * The single sign-on door: `POST /api/auth/sign-in/sso` is mounted at all, and
 * what identity's assertion gate makes of a verified assertion on the way to a
 * session (ADR-117 §5).
 */
import { createApiFixture } from "@langwatch/api-fixture";
import { SsoSignInRefusedError, type SsoAssertionApi } from "@langwatch/identity-contract";
import { describe, expect, it, vi } from "vitest";

import { resolveSsoUser } from "../../channels/http/http.better-auth.channel.ts";
import { betterAuthTransportFor } from "./better-auth-transport.test-helpers.ts";

const signInThroughSso = async (body: Record<string, unknown>) => {
  const response = await betterAuthTransportFor().handler(
    new Request("https://app.langwatch.test/api/auth/sign-in/sso", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  return { status: response.status, body: (await response.json()) as { message?: string } };
};

/** The shape the plugin hands a resolver, with only the fields read here. */
const assertionOf = (email: string) =>
  ({
    protocol: "oidc",
    providerId: "connection_1",
    accountKey: { issuer: "https://idp.acme.test", accountId: "subject-1" },
    providerUser: { email, emailVerified: true, name: "A Person" },
    providerReference: {
      providerId: "connection_1",
      source: { type: "configured" },
      authenticationConfigurationFingerprint: "fingerprint",
    },
    providerClaims: {},
    verifiedIdTokenClaims: {},
  }) as Parameters<typeof resolveSsoUser>[0]["input"];

describe("given the single sign-on plugin this deployment mounts", () => {
  it("answers the sign-in door rather than 404, and names what it still needs", async () => {
    const { status, body } = await signInThroughSso({ callbackURL: "/" });

    expect(status).toBe(400);
    expect(body.message).toBe("email, organizationSlug, domain or providerId is required");
  });

  it("finds no connection for a domain nobody registered", async () => {
    const { status, body } = await signInThroughSso({
      email: "person@nobody.test",
      callbackURL: "/",
    });

    expect(status).toBe(404);
    expect(body.message).toBe("No provider found for the issuer");
  });
});

describe("given identity decides whether an assertion may become a session", () => {
  it("lets an admitted assertion through", async () => {
    const assertions = createApiFixture<SsoAssertionApi>({
      decide: async () => ({ action: "continue" }),
    });

    await expect(
      resolveSsoUser({ assertions, input: assertionOf("person@acme.test") }),
    ).resolves.toEqual({ action: "continue" });
  });

  it("asks with the subject the provider asserted, not the address alone", async () => {
    const decide = vi.fn(async () => ({ action: "continue" }) as const);

    await resolveSsoUser({
      assertions: createApiFixture<SsoAssertionApi>({ decide }),
      input: assertionOf("person@acme.test"),
    });

    expect(decide).toHaveBeenCalledWith({
      providerId: "connection_1",
      accountId: "subject-1",
      email: "person@acme.test",
    });
  });

  it("returns a refusal as the plugin's own rejection, never throwing it", async () => {
    const error = new SsoSignInRefusedError("the connection is not accepting sign-in");
    const assertions = createApiFixture<SsoAssertionApi>({
      decide: async () => ({
        action: "reject",
        reason: "connection-not-accepting-sign-in",
        error,
      }),
    });

    await expect(
      resolveSsoUser({ assertions, input: assertionOf("person@acme.test") }),
    ).resolves.toEqual({ action: "reject", code: error.code });
  });
});
