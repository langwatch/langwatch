/**
 * @vitest-environment node
 * @see specs/auth/password-reset.feature
 * The process's real Better Auth transport over one in-memory identity store:
 * a reset token that will not spend, and a sign-in that cannot say which half was wrong.
 */
import { randomUUID } from "node:crypto";

import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { hash } from "bcrypt";
import { memoryAdapter } from "better-auth/adapters/memory";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { BetterAuthHooksRepository } from "../../repositories/better-auth-hooks.repository.ts";
import { betterAuthTransportFor } from "./better-auth-transport.test-helpers.ts";

type MemoryDb = Record<string, Record<string, unknown>[]>;

const BASE_URL = "https://app.langwatch.test";
const EMAIL = "holder@company.test";
const OLD_PASSWORD = "the-old-password-1";

afterEach(() => {
  vi.useRealTimers();
});

async function seededHolder() {
  const userId = `user-${randomUUID()}`;
  const db: MemoryDb = {
    User: [
      {
        id: userId,
        name: "Holder",
        email: EMAIL,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
    Session: [],
    Account: [
      {
        id: `account-${randomUUID()}`,
        userId,
        accountId: userId,
        providerId: "credential",
        password: await hash(OLD_PASSWORD, 10),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
    VerificationToken: [],
    ssoProvider: [],
  };

  return { db, userId };
}

function transportOver({ db }: { db: MemoryDb }) {
  const sent: { email: string; token: string }[] = [];
  const revoked: string[] = [];
  const transport = betterAuthTransportFor(
    {},
    {
      storage: { adapter: () => memoryAdapter(db) } as never,
      database: createApiFixture<BetterAuthHooksRepository>({
        getUserForHooks: async ({ userId }) => ({
          id: userId,
          email: EMAIL,
          name: "Holder",
          deactivatedAt: null,
          pendingSsoSetup: false,
          signupConfirmationPending: false,
        }),
      }),
      sendResetPassword: async (mail) => {
        sent.push(mail);
      },
      auth: {
        revokeAllBrowserSessions: async ({ userId }: { userId: string }) => {
          revoked.push(userId);
        },
      } as never,
    },
  );

  const post = (path: string, body: unknown) =>
    transport.handler(
      new Request(`${BASE_URL}/api/auth${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: BASE_URL },
        body: JSON.stringify(body),
      }),
    );

  const requestToken = async () => {
    const answered = await post("/request-password-reset", { email: EMAIL });
    expect(answered.status).toBe(200);
    const mail = sent.at(-1);
    if (!mail) throw new Error("no reset mail was sent");

    return mail.token;
  };

  return { post, requestToken, revoked };
}

/** The transport releases a handled refusal as a throw; the host's error handler answers it. */
async function refusalOf(answer: Promise<Response>): Promise<unknown> {
  try {
    return await answer;
  } catch (error) {
    return error;
  }
}

const credentialOf = (db: MemoryDb) => db.Account?.map((account) => account.password);

describe("a reset token that will not spend", () => {
  /** @scenario A consumed reset token cannot change credentials or mint a session */
  it("refuses a token that has already changed the password and changes nothing", async () => {
    const { db } = await seededHolder();
    const { post, requestToken } = transportOver({ db });
    const token = await requestToken();
    const first = await post("/reset-password", { token, newPassword: "the-first-new-password" });
    expect(first.status).toBe(200);
    const credentialAfterFirst = credentialOf(db);

    const sessionsAfterFirst = structuredClone(db.Session);

    const refusal = await refusalOf(
      post("/reset-password", { token, newPassword: "a-different-password-2" }),
    );

    expect(refusal).toMatchObject({ code: "identity_reset_link_invalid", httpStatus: 400 });
    expect(credentialOf(db)).toEqual(credentialAfterFirst);
    expect(db.Session).toEqual(sessionsAfterFirst);
  });

  /** @scenario An expired reset token cannot change credentials or mint a session */
  it("refuses a token past its hour and changes nothing", async () => {
    const { db } = await seededHolder();
    const { post, requestToken } = transportOver({ db });
    vi.useFakeTimers({ toFake: ["Date"] });
    const token = await requestToken();
    const credentialBefore = credentialOf(db);
    vi.setSystemTime(Date.now() + 61 * 60 * 1000);

    const refusal = await refusalOf(
      post("/reset-password", { token, newPassword: "the-first-new-password" }),
    );

    expect(refusal).toMatchObject({ code: "identity_reset_link_invalid", httpStatus: 400 });
    expect(credentialOf(db)).toEqual(credentialBefore);
    expect(db.Session).toEqual([]);
  });
});

describe("a sign-in that cannot be told which half was wrong", () => {
  /** @scenario Wrong-password and unknown-email attempts have one backend refusal */
  it("refuses a wrong password and an unknown address with the same answer and creates nothing", async () => {
    const { db } = await seededHolder();
    const { post } = transportOver({ db });
    const before = structuredClone(db);

    const wrongPassword = await refusalOf(
      post("/sign-in/email", { email: EMAIL, password: "not-the-password-1" }),
    );
    const unknownAddress = await refusalOf(
      post("/sign-in/email", { email: "nobody@company.test", password: "not-the-password-1" }),
    );

    expect(wrongPassword).toMatchObject({ code: "identity_sign_in_refused" });
    expect(unknownAddress).toMatchObject({ code: "identity_sign_in_refused" });
    expect((unknownAddress as { httpStatus: number }).httpStatus).toBe(
      (wrongPassword as { httpStatus: number }).httpStatus,
    );
    expect((unknownAddress as Error).message).toBe((wrongPassword as Error).message);
    expect(db.User).toEqual(before.User);
    expect(db.Account).toEqual(before.Account);
    expect(db.Session).toEqual([]);
  });
});
