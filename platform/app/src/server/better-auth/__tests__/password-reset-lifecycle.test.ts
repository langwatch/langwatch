/**
 * Password reset against BetterAuth's real handlers, hashing, token storage,
 * request hooks, and memory adapter. Only email delivery and the revocation
 * effect are test boundaries. Deleting memory rows proves the reset calls that
 * effect before minting; canonical durable-ledger revocation is covered by the
 * dedicated session-revocation tests.
 */

import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { createAuthMiddleware } from "better-auth/api";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("../../mailer/resetPasswordEmail", () => ({
  sendResetPasswordEmail: vi.fn().mockResolvedValue(void 0),
}));

import { sendResetPasswordEmail } from "../../mailer/resetPasswordEmail";
import { emailAndPassword } from "../config/email-and-password";
import { PasswordResetSessionBridge } from "../password-reset-session";
import { BetterAuthSessionMinter } from "../session-minter";

type MemoryDB = Record<string, Record<string, unknown>[]>;

const email = "credential-user@example.com";
const oldPassword = "old-password-1";
const newPassword = "new-password-2";
const sessionSchema = z
  .object({ user: z.object({ email: z.string() }) })
  .nullable();
const refusalSchema = z.object({
  code: z.string(),
  message: z.string(),
});

function rows(db: MemoryDB, model: string): Record<string, unknown>[] {
  return db[model] ?? [];
}

function buildHarness() {
  const db: MemoryDB = {
    user: [],
    session: [],
    account: [],
    verification: [],
  };
  const bridge = new PasswordResetSessionBridge({
    minter: new BetterAuthSessionMinter(),
  });
  const passwordOptions = emailAndPassword({
    hashRounds: 4,
    revokeAllSessions: async ({ userId }) => {
      db.session = rows(db, "session").filter(
        (session) => session.userId !== userId,
      );
    },
    recordPasswordReset: ({ userId }) => {
      bridge.recordPasswordReset({ userId });
    },
  });
  if (!passwordOptions) {
    throw new Error("password reset must be configured for this harness");
  }

  const auth = betterAuth({
    baseURL: "http://localhost:3000",
    secret: "test-secret-test-secret-test-secret",
    database: memoryAdapter(db),
    emailAndPassword: { ...passwordOptions, enabled: true },
    hooks: {
      after: createAuthMiddleware(async (ctx) => {
        await bridge.signInAfterPasswordReset(ctx);
      }),
    },
  });

  return { auth, bridge, db };
}

type Harness = ReturnType<typeof buildHarness>;

function post(path: string, body: Record<string, string>): Request {
  return new Request(`http://localhost:3000/api/auth${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function responseCookie(response: Response): string {
  const setCookie = response.headers.get("set-cookie");
  if (!setCookie) {
    throw new Error("the response set no cookie");
  }

  return setCookie.split(";")[0] ?? "";
}

async function signUp(harness: Harness): Promise<string> {
  const response = await harness.auth.handler(
    post("/sign-up/email", {
      email,
      name: "Credential User",
      password: oldPassword,
    }),
  );
  if (response.status !== 200) {
    throw new Error(`sign-up failed with status ${response.status}`);
  }
  return responseCookie(response);
}

async function signIn(
  harness: Harness,
  candidateEmail: string,
  password: string,
): Promise<Response> {
  return harness.auth.handler(
    post("/sign-in/email", { email: candidateEmail, password }),
  );
}

async function requestReset(harness: Harness): Promise<string> {
  const response = await harness.auth.handler(
    post("/request-password-reset", {
      email,
      redirectTo: "/auth/reset-password",
    }),
  );
  if (response.status !== 200) {
    throw new Error(`reset request failed with status ${response.status}`);
  }

  const sent = vi.mocked(sendResetPasswordEmail).mock.calls.at(-1)?.[0];
  if (!sent) {
    throw new Error("the reset email was not sent");
  }

  const token = new URL(
    sent.resetUrl,
    "http://localhost:3000",
  ).searchParams.get("token");
  if (!token) {
    throw new Error("the reset email carried no token");
  }

  return token;
}

async function submitReset({
  harness,
  token,
  password = newPassword,
}: {
  harness: Harness;
  token: string;
  password?: string;
}): Promise<Response> {
  return harness.bridge.runWithScope(() =>
    harness.auth.handler(
      post("/reset-password", { token, newPassword: password }),
    ),
  );
}

async function sessionForCookie(
  harness: Harness,
  cookie: string,
): Promise<z.infer<typeof sessionSchema>> {
  const response = await harness.auth.handler(
    new Request("http://localhost:3000/api/auth/get-session", {
      headers: { cookie },
    }),
  );
  if (response.status !== 200) {
    throw new Error(`session lookup failed with status ${response.status}`);
  }
  return sessionSchema.parse(await response.json());
}

function snapshotCredentialAndSessions(harness: Harness) {
  return structuredClone({
    users: rows(harness.db, "user"),
    accounts: rows(harness.db, "account"),
    sessions: rows(harness.db, "session"),
  });
}

describe("better-auth password reset token lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /** @scenario A successful reset revokes all of the user's existing sessions */
  it("invalidates old cookies, changes the credential, and opens a usable reset session", async () => {
    const harness = buildHarness();
    const signUpCookie = await signUp(harness);
    const signInResponse = await signIn(harness, email, oldPassword);
    expect(signInResponse.status).toBe(200);
    const signInCookie = responseCookie(signInResponse);
    expect(signInCookie).not.toBe(signUpCookie);
    expect(rows(harness.db, "session")).toHaveLength(2);
    expect(await sessionForCookie(harness, signUpCookie)).toMatchObject({
      user: { email },
    });
    expect(await sessionForCookie(harness, signInCookie)).toMatchObject({
      user: { email },
    });

    const token = await requestReset(harness);
    const response = await submitReset({ harness, token });

    expect(response.status).toBe(200);
    const resetCookie = responseCookie(response);
    expect(rows(harness.db, "session")).toHaveLength(1);
    expect(await sessionForCookie(harness, signUpCookie)).toBeNull();
    expect(await sessionForCookie(harness, signInCookie)).toBeNull();
    expect(await sessionForCookie(harness, resetCookie)).toMatchObject({
      user: { email },
    });

    const oldPasswordResponse = await signIn(harness, email, oldPassword);
    expect(oldPasswordResponse.status).toBe(401);
    expect(refusalSchema.parse(await oldPasswordResponse.json()).code).toBe(
      "INVALID_EMAIL_OR_PASSWORD",
    );

    const newPasswordResponse = await signIn(harness, email, newPassword);
    expect(newPasswordResponse.status).toBe(200);
    const newPasswordCookie = responseCookie(newPasswordResponse);
    expect(await sessionForCookie(harness, newPasswordCookie)).toMatchObject({
      user: { email },
    });
  });

  /** @scenario A consumed reset token cannot change credentials or mint a session */
  it("refuses a consumed token without changing credentials or sessions again", async () => {
    const harness = buildHarness();
    await signUp(harness);
    const token = await requestReset(harness);
    const accepted = await submitReset({ harness, token });
    expect(accepted.status).toBe(200);
    const afterFirstUse = snapshotCredentialAndSessions(harness);

    const replay = await submitReset({
      harness,
      token,
      password: "attacker-chosen-password-3",
    });

    expect(replay.status).toBe(400);
    expect(refusalSchema.parse(await replay.json()).code).toBe("INVALID_TOKEN");
    expect(snapshotCredentialAndSessions(harness)).toEqual(afterFirstUse);
    expect((await signIn(harness, email, newPassword)).status).toBe(200);
    expect(
      (await signIn(harness, email, "attacker-chosen-password-3")).status,
    ).toBe(401);
  });

  /** @scenario An expired reset token cannot change credentials or mint a session */
  it("refuses an expired token without changing credentials or sessions", async () => {
    const harness = buildHarness();
    await signUp(harness);
    const token = await requestReset(harness);
    const verification = rows(harness.db, "verification").at(-1);
    if (!verification) {
      throw new Error("the reset token was not stored");
    }
    verification.expiresAt = new Date(Date.now() - 1);
    const beforeExpiredUse = snapshotCredentialAndSessions(harness);

    const expired = await submitReset({ harness, token });

    expect(expired.status).toBe(400);
    expect(refusalSchema.parse(await expired.json()).code).toBe(
      "INVALID_TOKEN",
    );
    expect(snapshotCredentialAndSessions(harness)).toEqual(beforeExpiredUse);
    expect((await signIn(harness, email, oldPassword)).status).toBe(200);
    expect((await signIn(harness, email, newPassword)).status).toBe(401);
  });
});

describe("better-auth generic password refusal", () => {
  /** @scenario Wrong-password and unknown-email attempts have one backend refusal */
  /** @scenario A refused credential still refuses in one way */
  it("gives wrong-password and unknown-email attempts the same refusal and writes nothing", async () => {
    const harness = buildHarness();
    await signUp(harness);
    const beforeRefusal = snapshotCredentialAndSessions(harness);

    const wrongPassword = await signIn(harness, email, "wrong-password-9");
    const unknownEmail = await signIn(
      harness,
      "unknown-user@example.com",
      oldPassword,
    );

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(refusalSchema.parse(await wrongPassword.json())).toEqual(
      refusalSchema.parse(await unknownEmail.json()),
    );
    expect(snapshotCredentialAndSessions(harness)).toEqual(beforeRefusal);
  });
});
