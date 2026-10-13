/**
 * The credential session guard inside a real Better Auth handler: a password and a second factor,
 * each checked against the recovery grant for the address that was proved.
 * @see specs/identity/sso-credential-enforcement.feature
 */
import { fromDate } from "@langwatch/time";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { symmetricDecrypt } from "better-auth/crypto";
import { twoFactor } from "better-auth/plugins/two-factor";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  type CredentialSignInPolicy,
  CredentialSessionGuard,
} from "../http.credential-session-guard.channel.ts";

const baseURL = "http://localhost:3000";
const credentialEmail = "owner@company.test";
const credentialPassword = "test-password-1";
const secret = "test-secret-test-secret-test-secret";
const identitySchema = z.object({ user: z.object({ id: z.string() }) });
const enrollmentSchema = z.object({ backupCodes: z.array(z.string()) });
const ceremonySchema = z.object({
  challengeId: z.string(),
  userId: z.string(),
  email: z.string(),
  expiresAtMs: z.number(),
});

function credentialRequest(path: string, body: Record<string, unknown>, cookie?: string) {
  return new Request(`${baseURL}/api/auth${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}

function responseCookies(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

/** A Better Auth handler wired with the guard exactly where the transport wires it. */
function credentialHandler({
  canSignIn,
  verifiedAlias,
}: {
  canSignIn: CredentialSignInPolicy["canSignIn"];
  verifiedAlias?: { email: string; canonicalEmail: string };
}) {
  const db: Record<string, Record<string, unknown>[]> = {
    user: [],
    session: [],
    account: [],
    verification: [],
    twoFactor: [],
  };
  const guard = CredentialSessionGuard.create({ canSignIn });
  const database: ReturnType<typeof memoryAdapter> = (options) => {
    const adapter = memoryAdapter(db)(options);
    return {
      ...adapter,
      // The verified company alias resolves to the canonical account, as the identity lookup does.
      findOne: (args) =>
        adapter.findOne({
          ...args,
          where: args.where?.map((clause) =>
            args.model === "user" &&
            clause.field === "email" &&
            verifiedAlias &&
            clause.value === verifiedAlias.email
              ? { ...clause, value: verifiedAlias.canonicalEmail }
              : clause,
          ),
        }),
    };
  };
  const options = {
    baseURL,
    secret,
    database,
    emailAndPassword: { enabled: true },
    plugins: [twoFactor({ issuer: "credential-guard-test" })],
  };
  const auth = betterAuth({
    ...options,
    databaseHooks: {
      verification: {
        create: {
          before: async (verification, context) => {
            await guard.beforeVerificationCreate({
              verification: { ...verification, expiresAt: fromDate(verification.expiresAt) },
              context,
            });
            return undefined;
          },
        },
      },
      session: {
        create: {
          before: async (session, context) => {
            await guard.beforeSessionCreate({ userId: session.userId, context });
          },
        },
      },
    },
  });
  const setupAuth = betterAuth(options);

  const seed = async ({ email = credentialEmail, mfa = false } = {}) => {
    const signup = await setupAuth.handler(
      credentialRequest("/sign-up/email", {
        email,
        password: credentialPassword,
        name: "Recovery holder",
      }),
    );
    if (signup.status !== 200) throw new Error(`signup failed: ${await signup.text()}`);
    const userId = identitySchema.parse(await signup.json()).user.id;
    let totpSecret = "";
    let backupCodes: string[] = [];
    if (mfa) {
      const enable = await setupAuth.handler(
        credentialRequest(
          "/two-factor/enable",
          { password: credentialPassword },
          responseCookies(signup),
        ),
      );
      if (enable.status !== 200) throw new Error(`enrollment failed: ${await enable.text()}`);
      backupCodes = enrollmentSchema.parse(await enable.json()).backupCodes;
      const factor = z
        .object({ secret: z.string() })
        .parse(db.twoFactor?.find((row) => row.userId === userId));
      totpSecret = await symmetricDecrypt({ key: secret, data: factor.secret });
      const { code } = await setupAuth.api.generateTOTP({ body: { secret: totpSecret } });
      const verified = await setupAuth.handler(
        credentialRequest("/two-factor/verify-totp", { code }, responseCookies(signup)),
      );
      if (verified.status !== 200) throw new Error(`enrollment verification failed`);
    }
    db.session = [];
    return { userId, totpSecret, backupCodes };
  };
  const signIn = (email = credentialEmail, password = credentialPassword) =>
    auth.handler(credentialRequest("/sign-in/email", { email, password }));
  const companions = () =>
    (db.verification ?? []).filter((row) => String(row.identifier).startsWith("sso-credential:"));
  return { auth, db, seed, signIn, companions };
}

describe("a password for an address an organization's connection governs", () => {
  /** @scenario "SSO governed passwords require a recovery grant in every deployment mode" */
  it("is refused without a live grant, and no session opens", async () => {
    const canSignIn = vi.fn(async () => false);
    const harness = credentialHandler({ canSignIn });
    const { userId } = await harness.seed();

    const response = await harness.signIn();

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "EMAIL_PASSWORD_DISABLED" });
    expect(canSignIn).toHaveBeenCalledWith({ userId, email: credentialEmail });
    expect(harness.db.session).toEqual([]);
  });

  /** @scenario "A current recovery holder can sign in with their verified password" */
  it("consults no grant for a wrong password and opens a session for the right one", async () => {
    const canSignIn = vi.fn(async () => true);
    const harness = credentialHandler({ canSignIn });
    const { userId } = await harness.seed();

    const wrong = await harness.signIn(credentialEmail, "wrong-password");
    expect(wrong.status).toBe(401);
    expect(canSignIn).not.toHaveBeenCalled();

    const response = await harness.signIn();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ user: { id: userId } });
    expect(harness.db.session).toHaveLength(1);
  });
});

describe("a recovery holder with a second factor", () => {
  /** @scenario "Recovery sign-in still requires the enrolled second factor" */
  it.each(["totp", "backup-code"])("rechecks the grant through %s", async (factor) => {
    const canSignIn = vi.fn(async () => true);
    const harness = credentialHandler({ canSignIn });
    const { userId, totpSecret, backupCodes } = await harness.seed({ mfa: true });

    const first = await harness.signIn();
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ twoFactorRedirect: true });
    expect(harness.db.session).toEqual([]);
    expect(harness.companions()).toHaveLength(1);

    const code =
      factor === "totp"
        ? (await harness.auth.api.generateTOTP({ body: { secret: totpSecret } })).code
        : backupCodes[0];
    const response = await harness.auth.handler(
      credentialRequest(
        `/two-factor/verify-${factor}`,
        { code, email: "unrelated@personal.test" },
        responseCookies(first),
      ),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ user: { id: userId } });
    expect(canSignIn).toHaveBeenCalledTimes(2);
    expect(canSignIn).toHaveBeenLastCalledWith({ userId, email: credentialEmail });
    expect(harness.db.session).toHaveLength(1);
    expect(harness.companions()).toEqual([]);
  });

  /** @scenario "A recovery grant must still be live when the second factor completes" */
  it.each(["revoked", "expired"])("refuses a grant %s before the factor", async (change) => {
    let expiresAtMs = Date.now() + 60_000;
    let revoked = false;
    const canSignIn = vi.fn(async () => !revoked && expiresAtMs > Date.now());
    const harness = credentialHandler({ canSignIn });
    const { backupCodes } = await harness.seed({ mfa: true });
    const first = await harness.signIn();
    expect(await first.json()).toMatchObject({ twoFactorRedirect: true });
    if (change === "revoked") revoked = true;
    else expiresAtMs = Date.now() - 1;

    const response = await harness.auth.handler(
      credentialRequest(
        "/two-factor/verify-backup-code",
        { code: backupCodes[0] },
        responseCookies(first),
      ),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "EMAIL_PASSWORD_DISABLED" });
    expect(canSignIn).toHaveBeenCalledTimes(2);
    expect(harness.db.session).toEqual([]);
    expect(harness.companions()).toEqual([]);
  });

  /** @scenario "Recovery checks retain the proved alias rather than the canonical email" */
  it("checks the company alias on both the password and the factor", async () => {
    const canonicalEmail = "owner@personal.test";
    const canSignIn = vi.fn(async ({ email }: { userId: string; email: string }) => {
      return email === credentialEmail;
    });
    const harness = credentialHandler({
      canSignIn,
      verifiedAlias: { email: credentialEmail, canonicalEmail },
    });
    const { userId, backupCodes } = await harness.seed({ email: canonicalEmail, mfa: true });
    const first = await harness.signIn(credentialEmail);
    expect(await first.json()).toMatchObject({ twoFactorRedirect: true });

    const response = await harness.auth.handler(
      credentialRequest(
        "/two-factor/verify-backup-code",
        { code: backupCodes[0], email: canonicalEmail },
        responseCookies(first),
      ),
    );

    expect(response.status).toBe(200);
    expect(canSignIn.mock.calls).toEqual([
      [{ userId, email: credentialEmail }],
      [{ userId, email: credentialEmail }],
    ]);
  });

  /** @scenario "A second factor cannot mint a session without its own unexpired credential ceremony" */
  it.each(["missing", "other-user", "other-challenge", "expired", "invalid-json"])(
    "refuses a %s ceremony",
    async (change) => {
      const canSignIn = vi.fn(async () => true);
      const harness = credentialHandler({ canSignIn });
      const { backupCodes } = await harness.seed({ mfa: true });
      const first = await harness.signIn();
      expect(await first.json()).toMatchObject({ twoFactorRedirect: true });
      const [companion] = harness.companions();
      if (!companion) throw new Error("password sign-in created no ceremony");
      const ceremony = ceremonySchema.parse(JSON.parse(z.string().parse(companion.value)));

      if (change === "missing") {
        harness.db.verification = (harness.db.verification ?? []).filter(
          (row) => row !== companion,
        );
      } else if (change === "invalid-json") {
        companion.value = "invalid";
      } else {
        if (change === "other-user") ceremony.userId = "another-user";
        if (change === "other-challenge") ceremony.challengeId = "another-challenge";
        if (change === "expired") ceremony.expiresAtMs = Date.now() - 1;
        companion.value = JSON.stringify(ceremony);
      }
      const response = await harness.auth.handler(
        credentialRequest(
          "/two-factor/verify-backup-code",
          { code: backupCodes[0] },
          responseCookies(first),
        ),
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: "EMAIL_PASSWORD_DISABLED" });
      expect(canSignIn).toHaveBeenCalledTimes(1);
      expect(harness.db.session).toEqual([]);
    },
  );

  /** @scenario "An existing session cannot complete another pending recovery sign-in" */
  it.each([false, true])("rechecks the pending sign-in (another user: %s)", async (otherUser) => {
    let allowed = true;
    const harness = credentialHandler({ canSignIn: async () => allowed });
    const holder = await harness.seed({ mfa: true });
    const activeEmail = otherUser ? "other@personal.test" : credentialEmail;
    const activeUser = otherUser ? await harness.seed({ email: activeEmail, mfa: true }) : holder;
    const activeFirst = await harness.signIn(activeEmail);
    const active = await harness.auth.handler(
      credentialRequest(
        "/two-factor/verify-backup-code",
        { code: activeUser.backupCodes[0] },
        responseCookies(activeFirst),
      ),
    );
    expect(active.status).toBe(200);
    const pending = await harness.signIn();
    expect(await pending.json()).toMatchObject({ twoFactorRedirect: true });
    const sessions = structuredClone(harness.db.session);
    allowed = false;
    const pendingCookie = responseCookies(pending)
      .split("; ")
      .filter((cookie) => cookie.includes("two_factor="))
      .join("; ");

    const existing = await harness.auth.handler(
      credentialRequest(
        "/two-factor/verify-backup-code",
        { code: activeUser.backupCodes[1] },
        `${responseCookies(active)}; ${pendingCookie}`,
      ),
    );
    expect(existing.status).toBe(200);
    expect(await existing.json()).toMatchObject({ user: { id: activeUser.userId } });
    expect(harness.db.session).toEqual(sessions);

    const completion = await harness.auth.handler(
      credentialRequest(
        "/two-factor/verify-backup-code",
        { code: holder.backupCodes[2] },
        pendingCookie,
      ),
    );
    expect(completion.status).toBe(400);
    expect(await completion.json()).toMatchObject({ code: "EMAIL_PASSWORD_DISABLED" });
    expect(harness.db.session).toEqual(sessions);
  });
});
