import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  credentialEmail,
  credentialHandler,
  credentialRequest,
  responseCookies,
} from "./support/credential-handler";

const federationModes = [false, true];
const secondFactors = ["totp", "backup-code"];
const endedGrants = ["revoked", "expired"];

describe("SSO credential enforcement at the mounted Better Auth handler", () => {
  /** @scenario "An organization's own connection still refuses a local password" */
  /** @scenario "SSO governed passwords require a recovery grant in every deployment mode" */
  it.each(federationModes)("requires a grant (%s)", async (enabled) => {
    const canSignIn = vi.fn(async () => false);
    const harness = credentialHandler({
      canSignIn,
      federationCapable: enabled,
    });
    const { userId } = await harness.seed();
    const response = await harness.signIn();
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      code: "EMAIL_PASSWORD_DISABLED",
    });
    expect(canSignIn).toHaveBeenCalledWith({
      userId,
      email: credentialEmail,
    });
    expect(harness.db.session).toEqual([]);
  });

  /** @scenario "A current recovery holder can sign in with their verified password" */
  it.each(federationModes)("verifies the password (%s)", async (enabled) => {
    const canSignIn = vi.fn(async () => true);
    const harness = credentialHandler({
      canSignIn,
      federationCapable: enabled,
    });
    const { userId } = await harness.seed();
    const wrong = await harness.signIn(credentialEmail, "wrong-password");
    expect(wrong.status).toBe(401);
    expect(canSignIn).not.toHaveBeenCalled();
    const response = await harness.signIn();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ user: { id: userId } });
    expect(harness.db.session).toHaveLength(1);
  });

  /** @scenario "A recovery grant cannot start a password reset for an SSO governed address" */
  it.each(federationModes)("refuses password resets (%s)", async (enabled) => {
    const harness = credentialHandler({
      canSignIn: async () => true,
      federationCapable: enabled,
    });
    await harness.seed();
    const response = await harness.auth.handler(
      credentialRequest("/request-password-reset", {
        email: credentialEmail,
      }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      code: "EMAIL_PASSWORD_DISABLED",
    });
    expect(harness.db.verification).toEqual([]);
  });

  /** @scenario "Recovery sign-in still requires the enrolled second factor" */
  it.each(secondFactors)("keeps the address through %s", async (factor) => {
    const canSignIn = vi.fn(async () => true);
    const harness = credentialHandler({ canSignIn });
    const { userId, totpSecret, backupCodes } = await harness.seed({
      mfa: true,
    });
    const first = await harness.signIn();
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ twoFactorRedirect: true });
    expect(harness.db.session).toEqual([]);
    const companion = harness.db.verification?.find((row) =>
      String(row.identifier).startsWith("sso-credential:"),
    );
    expect(companion).toBeDefined();
    const code =
      factor === "totp"
        ? (
            await harness.auth.api.generateTOTP({
              body: { secret: totpSecret },
            })
          ).code
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
    expect(canSignIn).toHaveBeenLastCalledWith({
      userId,
      email: credentialEmail,
    });
    expect(canSignIn).toHaveBeenCalledTimes(2);
    expect(harness.db.session).toHaveLength(1);
    expect(
      harness.db.verification?.filter((row) =>
        String(row.identifier).startsWith("sso-credential:"),
      ),
    ).toEqual([]);
  });

  /** @scenario "A recovery grant must still be live when the second factor completes" */
  it.each(endedGrants)("refuses %s grants after MFA", async (change) => {
    let expiresAt = Date.now() + 60_000;
    let revoked = false;
    const canSignIn = vi.fn(async () => !revoked && expiresAt > Date.now());
    const harness = credentialHandler({ canSignIn });
    const { backupCodes } = await harness.seed({ mfa: true });
    const first = await harness.signIn();
    expect(await first.json()).toMatchObject({ twoFactorRedirect: true });
    if (change === "revoked") revoked = true;
    else expiresAt = Date.now() - 1;
    const response = await harness.auth.handler(
      credentialRequest(
        "/two-factor/verify-backup-code",
        { code: backupCodes[0] },
        responseCookies(first),
      ),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      code: "EMAIL_PASSWORD_DISABLED",
    });
    expect(canSignIn).toHaveBeenCalledTimes(2);
    expect(harness.db.session).toEqual([]);
    expect(
      harness.db.verification?.filter((row) =>
        String(row.identifier).startsWith("sso-credential:"),
      ),
    ).toEqual([]);
  });

  /** @scenario "Recovery checks retain the proved alias rather than the canonical email" */
  it("checks the verified company alias through both password and second factor", async () => {
    const canonicalEmail = "owner@personal.test";
    const canSignIn = vi.fn(
      async ({ email }: { userId: string; email: string }) =>
        email === credentialEmail,
    );
    const harness = credentialHandler({
      canSignIn,
      verifiedAlias: { email: credentialEmail, canonicalEmail },
    });
    const { userId, backupCodes } = await harness.seed({
      email: canonicalEmail,
      mfa: true,
    });
    expect(canSignIn).not.toHaveBeenCalled();
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
    expect(await response.json()).toMatchObject({
      user: { id: userId, email: canonicalEmail },
    });
    expect(canSignIn.mock.calls).toEqual([
      [{ userId, email: credentialEmail }],
      [{ userId, email: credentialEmail }],
    ]);
  });

  /** @scenario "A second factor cannot mint a session without its own unexpired credential ceremony" */
  it.each([
    "missing",
    "other-user",
    "other-challenge",
    "expired",
    "invalid-json",
  ])("refuses a %s companion", async (change) => {
    const canSignIn = vi.fn(async () => true);
    const harness = credentialHandler({ canSignIn });
    const { backupCodes } = await harness.seed({ mfa: true });
    const first = await harness.signIn();
    expect(await first.json()).toMatchObject({ twoFactorRedirect: true });
    const companion = harness.db.verification?.find((row) =>
      String(row.identifier).startsWith("sso-credential:"),
    );
    if (!companion) throw new Error("password sign-in created no companion");
    const ceremony = z
      .object({
        challengeId: z.string(),
        userId: z.string(),
        email: z.string(),
        expiresAtMs: z.number(),
      })
      .parse(JSON.parse(z.string().parse(companion.value)));
    const challenge = harness.db.verification?.find(
      (row) => row.identifier === ceremony.challengeId,
    );
    expect(companion.expiresAt).toEqual(challenge?.expiresAt);
    if (change === "missing")
      harness.db.verification =
        harness.db.verification?.filter((row) => row !== companion) ?? [];
    else if (change === "invalid-json") companion.value = "invalid";
    else {
      if (change === "other-user") ceremony.userId = "another-user";
      if (change === "other-challenge")
        ceremony.challengeId = "another-challenge";
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
    expect(await response.json()).toMatchObject({
      code: "EMAIL_PASSWORD_DISABLED",
    });
    expect(canSignIn).toHaveBeenCalledTimes(1);
    expect(harness.db.session).toEqual([]);
  });

  /** @scenario "An existing session cannot complete another pending recovery sign-in" */
  it.each([false, true])("rechecks login (other=%s)", async (otherUser) => {
    let allowed = true;
    const harness = credentialHandler({ canSignIn: async () => allowed });
    const holder = await harness.seed({ mfa: true });
    const activeEmail = otherUser ? "other@personal.test" : credentialEmail;
    const activeUser = otherUser
      ? await harness.seed({ email: activeEmail, mfa: true })
      : holder;
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
    expect(await existing.json()).toMatchObject({
      user: { id: activeUser.userId },
    });
    expect(harness.db.session).toEqual(sessions);
    const completion = await harness.auth.handler(
      credentialRequest(
        "/two-factor/verify-backup-code",
        { code: holder.backupCodes[2] },
        pendingCookie,
      ),
    );
    expect(completion.status).toBe(400);
    expect(await completion.json()).toMatchObject({
      code: "EMAIL_PASSWORD_DISABLED",
    });
    expect(harness.db.session).toEqual(sessions);
  });
});
