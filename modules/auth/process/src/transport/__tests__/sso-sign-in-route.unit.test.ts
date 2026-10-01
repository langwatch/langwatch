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

/** The library's transaction, recording what the resolver writes inside it. */
const transaction = () => {
  const update = vi.fn(async () => null);
  const database = createApiFixture<TransactionContext["database"]>({ update });
  return { update, context: { database } };
};
type TransactionContext = Parameters<typeof resolveSsoUser>[0]["context"];

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
  it("lets an admitted assertion through to the user identity resolves", async () => {
    const assertions = createApiFixture<SsoAssertionApi>({
      decide: async () => ({ action: "continue" }),
      resolveUser: async () => ({ action: "link", userId: "user_1", profile: "preserve" }),
    });

    await expect(
      resolveSsoUser({
        assertions,
        input: assertionOf("person@acme.test"),
        context: transaction().context,
      }),
    ).resolves.toEqual({ action: "link", userId: "user_1", profile: "preserve" });
  });

  /** @scenario "A verified domain's identity provider links an unconfirmed password account" */
  it("confirms the address inside the library's transaction before linking", async () => {
    const { update, context } = transaction();
    const assertions = createApiFixture<SsoAssertionApi>({
      decide: async () => ({ action: "continue" }),
      resolveUser: async () => ({
        action: "link",
        userId: "user_1",
        profile: "preserve",
        confirmAddress: true,
      }),
    });

    await expect(
      resolveSsoUser({ assertions, input: assertionOf("person@acme.test"), context }),
    ).resolves.toEqual({ action: "link", userId: "user_1", profile: "preserve" });
    expect(update).toHaveBeenCalledWith({
      model: "user",
      where: [{ field: "id", value: "user_1" }],
      update: { emailVerified: true },
    });
  });

  it("asks with the subject the provider asserted, not the address alone", async () => {
    const decide = vi.fn(async () => ({ action: "continue" }) as const);
    const resolveUser = vi.fn(async () => ({ action: "continue" }) as const);

    await resolveSsoUser({
      assertions: createApiFixture<SsoAssertionApi>({ decide, resolveUser }),
      input: assertionOf("person@acme.test"),
      context: transaction().context,
    });

    expect(decide).toHaveBeenCalledWith({
      providerId: "connection_1",
      accountId: "subject-1",
      email: "person@acme.test",
    });
    expect(resolveUser).toHaveBeenCalledWith({
      protocol: "oidc",
      providerId: "connection_1",
      accountKey: { issuer: "https://idp.acme.test", accountId: "subject-1" },
      email: "person@acme.test",
      emailVerified: true,
      emailVerification: "unasserted",
    });
  });

  /** @scenario "Microsoft Entra ID's xms_edov true links an unconfirmed password account" */
  it.each([
    [{ xms_edov: true }, "verified"],
    [{ xms_edov: false }, "unverified"],
    [{}, "unasserted"],
  ] as const)("reads Entra ID's %o as %s", async (claims, emailVerification) => {
    const resolveUser = vi.fn(async () => ({ action: "continue" }) as const);
    const entraIssuer = "https://login.microsoftonline.com/tenant-1/v2.0";

    await resolveSsoUser({
      assertions: createApiFixture<SsoAssertionApi>({
        decide: async () => ({ action: "continue" }),
        resolveUser,
      }),
      input: {
        ...assertionOf("person@acme.test"),
        accountKey: { issuer: entraIssuer, accountId: "subject-1" },
        providerUser: { email: "person@acme.test", emailVerified: false, name: "A Person" },
        verifiedIdTokenClaims: { iss: entraIssuer, ...claims },
      } as Parameters<typeof resolveSsoUser>[0]["input"],
      context: transaction().context,
    });

    expect(resolveUser).toHaveBeenCalledWith(
      expect.objectContaining({ emailVerified: false, emailVerification }),
    );
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
      resolveSsoUser({
        assertions,
        input: assertionOf("person@acme.test"),
        context: transaction().context,
      }),
    ).resolves.toEqual({ action: "reject", code: error.code });
  });

  it("never asks which user a refused assertion belongs to", async () => {
    const resolveUser = vi.fn(async () => ({ action: "continue" }) as const);
    const assertions = createApiFixture<SsoAssertionApi>({
      decide: async () => ({
        action: "reject",
        reason: "domain-not-verified",
        error: new SsoSignInRefusedError("the connection has never proved the asserted domain"),
      }),
      resolveUser,
    });

    await resolveSsoUser({
      assertions,
      input: assertionOf("person@acme.test"),
      context: transaction().context,
    });

    expect(resolveUser).not.toHaveBeenCalled();
  });
});
