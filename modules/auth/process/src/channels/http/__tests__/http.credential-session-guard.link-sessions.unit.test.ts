/**
 * @vitest-environment node
 * @see specs/identity/sso-credential-enforcement.feature
 */
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { createAuthMiddleware } from "better-auth/api";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { CredentialSessionGuard } from "../http.credential-session-guard.channel.ts";
import { PasswordResetSessionChannel } from "../http.password-reset-session.channel.ts";
import { signUpConfirmationPlugin } from "../http.sign-up-confirmation.channel.ts";

const ORIGIN = "http://localhost:3000";
const HOLDER = { email: "member@governed.test", password: "correct-horse-battery", name: "Sam" };
const SIGNED_UP = z.object({ user: z.object({ id: z.string() }) });

function harness({ permitted }: { permitted: boolean }) {
  const canSignIn = vi.fn(async () => permitted);
  const guard = CredentialSessionGuard.create({ canSignIn });
  const resetSession = PasswordResetSessionChannel.create();
  const userIds = new Map<string, string>();
  let resetToken = "";
  const database: Record<string, Record<string, unknown>[]> = {
    user: [],
    session: [],
    account: [],
    verification: [],
  };
  const auth = betterAuth({
    baseURL: ORIGIN,
    secret: "test-secret-test-secret-test-secret",
    database: memoryAdapter(database),
    emailAndPassword: {
      enabled: true,
      sendResetPassword: async ({ token }) => {
        resetToken = token;
      },
      onPasswordReset: async ({ user }, request) => {
        resetSession.recordPasswordReset({ userId: user.id, request });
      },
    },
    hooks: {
      after: createAuthMiddleware(async (ctx) => {
        await resetSession.signInAfterPasswordReset(ctx);
      }),
    },
    databaseHooks: {
      session: {
        create: {
          before: async (session, context) => {
            await guard.beforeSessionCreate({ userId: session.userId, context });
          },
        },
      },
    },
    plugins: [
      signUpConfirmationPlugin({
        verification: {
          completeVerification: async () => ({
            email: HOLDER.email,
            accountCreated: false,
            accountExists: true,
            addressProof: null,
            freshClaim: true,
          }),
        },
        users: {
          findByEmail: async ({ email }) => {
            const id = userIds.get(email);
            return id
              ? {
                  id,
                  email,
                  name: null,
                  emailVerified: true,
                  image: null,
                  pendingSsoSetup: false,
                  createdAt: new Date(0),
                  updatedAt: new Date(0),
                  lastLoginAt: null,
                  deactivatedAt: null,
                }
              : null;
          },
        },
      }),
    ],
  });
  const post = (path: string, body: unknown) =>
    auth.handler(
      new Request(`${ORIGIN}/api/auth${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: ORIGIN },
        body: JSON.stringify(body),
      }),
    );
  const registered = async (): Promise<string> => {
    const response = await post("/sign-up/email", HOLDER);
    const { user } = SIGNED_UP.parse(await response.json());
    userIds.set(HOLDER.email, user.id);
    database.session = [];
    canSignIn.mockClear();
    return user.id;
  };
  const resetPassword = async () => {
    await post("/request-password-reset", { email: HOLDER.email, redirectTo: "/" });
    return post("/reset-password", { token: resetToken, newPassword: "a-new-long-password" });
  };
  return { post, registered, resetPassword, canSignIn, database };
}

describe("sessions opened by an emailed link at an SSO-governed address", () => {
  describe("when the address holds no recovery grant", () => {
    it("opens no session after a password reset", async () => {
      const subject = harness({ permitted: false });
      const userId = await subject.registered();

      const response = await subject.resetPassword();

      expect(response.status).toBe(200);
      expect(subject.canSignIn).toHaveBeenCalledWith({ userId, email: HOLDER.email });
      expect(subject.database.session).toEqual([]);
      expect(response.headers.get("set-cookie") ?? "").not.toContain("session_token");
    });

    it("opens no session when the sign-up link confirms the address", async () => {
      const subject = harness({ permitted: false });
      const userId = await subject.registered();

      const response = await subject.post("/sign-up/confirm-address", { token: "tok" });

      expect(await response.json()).toMatchObject({ accountExists: true, signedIn: false });
      expect(subject.canSignIn).toHaveBeenCalledWith({ userId, email: HOLDER.email });
      expect(subject.database.session).toEqual([]);
    });
  });

  describe("when the address may sign in", () => {
    it("opens the session after a password reset", async () => {
      const subject = harness({ permitted: true });
      await subject.registered();

      await subject.resetPassword();

      expect(subject.database.session).toHaveLength(1);
    });

    it("opens the session when the sign-up link confirms the address", async () => {
      const subject = harness({ permitted: true });
      await subject.registered();

      const response = await subject.post("/sign-up/confirm-address", { token: "tok" });

      expect(await response.json()).toMatchObject({ signedIn: true });
      expect(subject.database.session).toHaveLength(1);
    });
  });
});
