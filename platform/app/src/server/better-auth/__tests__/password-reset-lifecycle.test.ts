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
import { rateLimit } from "../config/rate-limit";
import { beforeSessionCreate } from "../hooks";
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

/**
 * @param sessionGate Wires the production session-create gate (`hooks.ts`) over
 *   this instance, so the sign-up latch and the deactivation check decide
 *   whether a session may be opened at all. Off by default: the tests that
 *   predate it are about the reset itself, and an ungated instance is the
 *   shorter statement of that.
 * @param throttled Wires the production rate-limit configuration
 *   (`config/rate-limit.ts`) so a budget can actually be spent. Off by default
 *   so the tests above are not counted against the reset endpoint's five an
 *   hour between them.
 */
function buildHarness({
  sessionGate = false,
  throttled = false,
}: {
  sessionGate?: boolean;
  throttled?: boolean;
} = {}) {
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
    ...(throttled
      ? { rateLimit: rateLimit({ hasSecondaryStorage: false }) }
      : {}),
    ...(sessionGate
      ? {
          databaseHooks: {
            session: {
              create: {
                before: async (session: { userId: string }) => {
                  const permitted = await beforeSessionCreate({
                    prisma: {
                      user: {
                        findUnique: async () => {
                          const user = rows(db, "user").find(
                            (candidate) => candidate.id === session.userId,
                          );
                          if (!user) return null;

                          return {
                            deactivatedAt:
                              user.deactivatedAt instanceof Date
                                ? user.deactivatedAt
                                : null,
                            signupConfirmationPending:
                              user.signupConfirmationPending === true,
                          };
                        },
                      },
                    },
                    session: { userId: session.userId },
                  });
                  return permitted === false ? false : void 0;
                },
              },
            },
          },
        }
      : {}),
    hooks: {
      after: createAuthMiddleware(async (ctx) => {
        await bridge.signInAfterPasswordReset(ctx);
      }),
    },
  });

  return { auth, bridge, db };
}

type Harness = ReturnType<typeof buildHarness>;

function post(
  path: string,
  body: Record<string, string>,
  headers: Record<string, string> = {},
): Request {
  return new Request(`http://localhost:3000/api/auth${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
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

/**
 * RESET IS NOT CONFIRMATION. A sign-up that never proved its address leaves the
 * account latched shut, and `onPasswordReset` deliberately does not clear that
 * latch: the row may already hold a credential planted before any mailbox
 * proof, and a reset proves the mailbox rather than that the account is
 * anybody's. So the password changes and the door stays closed — which is only
 * true because the session gate runs for the reset's own mint as well as for a
 * sign-in.
 */
describe("better-auth password reset on an unconfirmed sign-up", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /** @scenario Password reset cannot open a session on an unconfirmed sign-up */
  it("sets the new password and still opens no session while the latch holds", async () => {
    const harness = buildHarness({ sessionGate: true });
    await signUp(harness);
    const user = rows(harness.db, "user")[0];
    if (!user) {
      throw new Error("the sign-up wrote no user row");
    }
    user.signupConfirmationPending = true;

    const token = await requestReset(harness);
    const response = await submitReset({ harness, token });

    // The reset itself succeeds — nothing about it is refused — and it opens
    // nothing: every session was revoked and the new one was denied at the
    // gate, so this device leaves with a password and no session.
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(rows(harness.db, "session")).toHaveLength(0);

    // And the account stays shut at the front door too. The credential DID
    // change, which is the half a reset is allowed to do.
    const refused = await signIn(harness, email, newPassword);
    expect(refused.status).toBe(401);
    await expect(refused.json()).resolves.toMatchObject({
      code: "FAILED_TO_CREATE_SESSION",
    });
    expect((await signIn(harness, email, oldPassword)).status).toBe(401);

    user.signupConfirmationPending = false;
    expect((await signIn(harness, email, newPassword)).status).toBe(200);
  });
});

/**
 * The cap, spent rather than read off the configuration. A test that asserts
 * `customRules["/reset-password"]` equals five an hour passes just as well when
 * the limiter is disabled, the path is misspelled, or the rule is shadowed —
 * which is how the NextAuth-era `/forget-password` rule matched nothing for a
 * whole migration. These drive the real endpoints until they are refused.
 *
 * Each case uses an address of its own, since better-auth's memory counters are
 * a process-wide map keyed by caller and path.
 */
describe("better-auth password reset rate limit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const resetRequest = (caller: string) =>
    post(
      "/request-password-reset",
      { email, redirectTo: "/auth/reset-password" },
      { "x-forwarded-for": caller },
    );

  /** @scenario Password reset endpoints are rate-limited to five attempts per hour */
  it("stops answering one caller's reset requests after five in the hour", async () => {
    const harness = buildHarness({ throttled: true });
    await signUp(harness);
    const caller = "203.0.113.11";

    for (let attempt = 0; attempt < 5; attempt++) {
      const allowed = await harness.auth.handler(resetRequest(caller));
      expect(allowed.status).toBe(200);
    }
    expect(sendResetPasswordEmail).toHaveBeenCalledTimes(5);

    const refused = await harness.auth.handler(resetRequest(caller));

    expect(refused.status).toBe(429);
    expect(sendResetPasswordEmail).toHaveBeenCalledTimes(5);
  });

  /** @scenario Password reset endpoints are rate-limited to five attempts per hour */
  it("stops accepting one caller's new-password submissions after five in the hour", async () => {
    const harness = buildHarness({ throttled: true });
    await signUp(harness);
    const caller = "203.0.113.12";
    const guess = (attempt: number) =>
      harness.bridge.runWithScope(() =>
        harness.auth.handler(
          post(
            "/reset-password",
            { token: `never-issued-${attempt}`, newPassword },
            { "x-forwarded-for": caller },
          ),
        ),
      );

    for (let attempt = 0; attempt < 5; attempt++) {
      const answered = await guess(attempt);
      expect(answered.status).toBe(400);
    }

    expect((await guess(5)).status).toBe(429);
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
