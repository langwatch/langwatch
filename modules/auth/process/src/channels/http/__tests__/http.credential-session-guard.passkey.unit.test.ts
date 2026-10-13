/**
 * @see specs/identity/sso-credential-enforcement.feature
 */
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { createAuthEndpoint } from "better-auth/api";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { CredentialSessionGuard } from "../http.credential-session-guard.channel.ts";

const primaryEmail = "holder@company.test";
const userId = "verified-passkey-holder";
const paths = ["/passkey/verify-authentication", "/passkey/verify-registration"] as const;

function sessionBoundary(path: (typeof paths)[number], permitted: boolean) {
  const canSignIn = vi.fn(async () => permitted);
  const guard = CredentialSessionGuard.create({ canSignIn });
  const database: Record<string, Record<string, unknown>[]> = {
    user: [
      {
        id: userId,
        email: primaryEmail,
        name: "Holder",
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
    session: [],
  };
  const auth = betterAuth({
    baseURL: "http://localhost:3000",
    secret: "test-secret-test-secret-test-secret",
    database: memoryAdapter(database),
    databaseHooks: {
      session: {
        create: {
          before: async (session, context) => {
            await guard.beforeSessionCreate({
              userId: session.userId,
              context,
            });
          },
        },
      },
    },
    plugins: [
      {
        id: "verified-passkey-session-boundary",
        endpoints: {
          // The passkey proof has already selected this user; exercise the
          // actual Better Auth session hook at the two plugin endpoint paths.
          mint: createAuthEndpoint(
            path,
            { method: "POST", body: z.object({ email: z.string() }) },
            async (ctx) => {
              const session = await ctx.context.internalAdapter.createSession(userId);
              return ctx.json({ session });
            },
          ),
        },
      },
    ],
  });
  const request = () =>
    auth.handler(
      new Request(`http://localhost:3000/api/auth${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "unmanaged@personal.test" }),
      }),
    );
  return { request, canSignIn, database };
}

describe("a verified passkey at the session boundary", () => {
  /** @scenario "Passkey sessions enforce recovery permission for the authenticated address" */
  it.each(paths)("refuses %s without a recovery grant", async (path) => {
    const harness = sessionBoundary(path, false);
    const response = await harness.request();
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      code: "EMAIL_PASSWORD_DISABLED",
    });
    expect(harness.canSignIn).toHaveBeenCalledWith({
      userId,
      email: primaryEmail,
    });
    expect(harness.database.session).toEqual([]);
  });

  it.each(paths)("permits %s when the authenticated address is authorized", async (path) => {
    const harness = sessionBoundary(path, true);
    const response = await harness.request();
    expect(response.status).toBe(200);
    expect(harness.canSignIn).toHaveBeenCalledWith({
      userId,
      email: primaryEmail,
    });
    expect(harness.database.session).toHaveLength(1);
  });
});
