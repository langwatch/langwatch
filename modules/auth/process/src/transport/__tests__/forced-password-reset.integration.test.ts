/**
 * @vitest-environment node
 * @see modules/auth/specs/forced-password-reset.feature
 * The process's real Better Auth transport and session-create hook over one in-memory store:
 * a marked password opens no session until a reset replaces it.
 */
import { randomUUID } from "node:crypto";

import { NO_SESSION_CLAIMS, type SsoMigrationCallbackApi } from "@langwatch/identity-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { hash } from "bcrypt";
import { memoryAdapter } from "better-auth/adapters/memory";
import { describe, expect, it } from "vitest";

import { MemoryAuthDatabase } from "../../repositories/memory/memory.auth.database.ts";
import { MemoryBetterAuthHooksRepository } from "../../repositories/memory/memory.better-auth-hooks.repository.ts";
import { providerAccountIssuer } from "../../rules/provider-account-issuer.rules.ts";
import { betterAuthTransportFor } from "./better-auth-transport.test-helpers.ts";

const BASE_URL = "https://app.langwatch.test";
const EMAIL = "holder@company.test";
const OLD_PASSWORD = "the-old-password-1";
const NEW_PASSWORD = "the-new-password-2";

/** Every lockout call the after-hook makes, by address. */
function recordingLockout() {
  const calls: { kind: "failure" | "success"; identifier: string }[] = [];
  return {
    calls,
    counter: {
      refuseIfLockedOut: async () => undefined,
      recordFailure: async ({ identifier }: { identifier: string }) => {
        calls.push({ kind: "failure", identifier });
      },
      recordSuccess: async ({ identifier }: { identifier: string }) => {
        calls.push({ kind: "success", identifier });
      },
    },
  };
}

async function markedHolder({
  marked = true,
  twoStep = false,
}: { marked?: boolean; twoStep?: boolean } = {}) {
  const memory = MemoryAuthDatabase.create();
  const lockout = recordingLockout();
  const userId = `user-${randomUUID()}`;
  memory.db.User.push({
    id: userId,
    name: "Holder",
    email: EMAIL,
    emailVerified: true,
    lastLoginAt: new Date(),
    passwordResetRequiredAt: marked ? new Date() : null,
    ...(twoStep ? { twoFactorEnabled: true } : {}),
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  memory.db.Account.push({
    id: `account-${randomUUID()}`,
    userId,
    providerAccountId: userId,
    provider: "credential",
    issuer: providerAccountIssuer({ connectionIssuer: undefined, provider: "credential" }),
    password: await hash(OLD_PASSWORD, 10),
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const sent: { email: string; token: string }[] = [];
  const transport = betterAuthTransportFor(
    { mfaEnrollmentOpen: twoStep },
    {
      signInLockout: lockout.counter,
      storage: memoryAdapter(memory.db),
      database: MemoryBetterAuthHooksRepository.create({ memory }),
      sendResetPassword: async (mail) => {
        sent.push(mail);
      },
      auth: { revokeAllBrowserSessions: async () => undefined } as never,
      ssoMigration: createApiFixture<SsoMigrationCallbackApi>({
        decideAccountLink: async () => ({ kind: "not_migrating" }),
        authorizeAndRecordAuthentication: async () => ({ action: "continue" }),
      }),
      mintClaims: { claimsForMint: async () => NO_SESSION_CLAIMS },
    },
  );

  const post = async (path: string, body: unknown): Promise<unknown> => {
    try {
      return await transport.handler(
        new Request(`${BASE_URL}/api/auth${path}`, {
          method: "POST",
          headers: { "content-type": "application/json", origin: BASE_URL },
          body: JSON.stringify(body),
        }),
      );
    } catch (error) {
      // The transport releases a handled refusal as a throw; the host answers it.
      return error;
    }
  };
  const mark = () => memory.db.User.find((user) => user.id === userId)?.passwordResetRequiredAt;

  return { memory, post, sent, mark, lockout };
}

describe("a password marked as requiring a reset", () => {
  /** @scenario "Completing a password reset clears the mark" */
  it("opens no session until a reset replaces it, then only the new password signs in", async () => {
    const { memory, post, sent, mark } = await markedHolder();

    const refused = await post("/sign-in/email", { email: EMAIL, password: OLD_PASSWORD });
    expect(refused).toMatchObject({ code: "identity_password_reset_required", httpStatus: 403 });
    expect(memory.db.Session).toEqual([]);

    const requested = await post("/request-password-reset", { email: EMAIL });
    expect(requested).toMatchObject({ status: 200 });
    const token = sent.at(-1)?.token;
    expect(token).toBeDefined();

    const reset = await post("/reset-password", { token, newPassword: NEW_PASSWORD });
    expect(reset).toMatchObject({ status: 200 });
    expect(mark()).toBeNull();

    const oldPassword = await post("/sign-in/email", { email: EMAIL, password: OLD_PASSWORD });
    expect(oldPassword).toMatchObject({ code: "identity_sign_in_refused" });

    const newPassword = await post("/sign-in/email", { email: EMAIL, password: NEW_PASSWORD });
    expect(newPassword).toMatchObject({ status: 200 });
  });
});

describe("a marked password with two-step verification turned on", () => {
  /** @scenario "A marked user who holds a second factor is refused before the challenge" */
  it("is refused with the reset code and no two-step challenge is started", async () => {
    const control = await markedHolder({ marked: false, twoStep: true });
    const challenged = await control.post("/sign-in/email", {
      email: EMAIL,
      password: OLD_PASSWORD,
    });
    expect(challenged).toBeInstanceOf(Response);
    expect(await (challenged as Response).json()).toMatchObject({ twoFactorRedirect: true });
    expect(control.memory.db.VerificationToken.length).toBeGreaterThan(0);

    const { memory, post } = await markedHolder({ twoStep: true });
    const refused = await post("/sign-in/email", { email: EMAIL, password: OLD_PASSWORD });

    expect(refused).toMatchObject({ code: "identity_password_reset_required", httpStatus: 403 });
    expect(memory.db.Session).toEqual([]);
    expect(memory.db.VerificationToken).toEqual([]);
  });
});

describe("the sign-in lockout for a marked password", () => {
  /** @scenario "A correct but marked password does not count toward the sign-in lockout" */
  it("does not count a correct but marked password as a failed attempt", async () => {
    const { post, lockout } = await markedHolder();

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const refused = await post("/sign-in/email", { email: EMAIL, password: OLD_PASSWORD });
      expect(refused).toMatchObject({ code: "identity_password_reset_required" });
    }
    expect(lockout.calls).toEqual([]);

    await post("/sign-in/email", { email: EMAIL, password: "a-wrong-password" });
    expect(lockout.calls).toEqual([{ kind: "failure", identifier: EMAIL }]);
  });
});
