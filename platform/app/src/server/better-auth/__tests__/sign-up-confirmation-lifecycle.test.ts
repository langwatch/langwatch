import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  SignUpVerificationService,
  type SignUpVerificationTokenStore,
} from "../../app-layer/identity/signup-verification.service";
import { BetterAuthSessionMinter } from "../session-minter";
import {
  SignUpConfirmationEndpoint,
  signUpConfirmation,
} from "../sign-up-confirmation";

type Row = Record<string, unknown>;
type MemoryDB = {
  user: Row[];
  session: Row[];
  account: Row[];
  verification: Row[];
} & Record<string, Row[]>;
type AuthUnderTest = {
  handler: (request: Request) => Promise<Response>;
};

const responseSchema = z.object({
  email: z.string(),
  accountExists: z.boolean(),
  signedIn: z.boolean(),
});

function buildHarness({
  existingAccount = false,
}: {
  existingAccount?: boolean;
} = {}) {
  const email = "pending@example.com";
  const userId = "pending-user";
  const now = new Date("2026-09-07T08:00:00.000Z");
  const db: MemoryDB = {
    user: existingAccount
      ? [
          {
            id: userId,
            name: "Pending User",
            email,
            emailVerified: false,
            signupConfirmationPending: true,
            createdAt: now,
            updatedAt: now,
          },
        ]
      : [],
    session: [],
    account: [],
    verification: [],
  };
  const issued = new Map<
    string,
    { identifier: string; expires: Date; spentUntil: Date | null }
  >();
  let sentToken = "";
  let sentEmail = "";
  let tokenSequence = 0;

  const tokens: SignUpVerificationTokenStore = {
    issue: async ({ identifier, token, expires }) => {
      issued.set(token, { identifier, expires, spentUntil: null });
    },
    claim: async ({ token, now: claimedAt, keepSpentUntil }) => {
      const row = issued.get(token);
      if (!row || row.spentUntil !== null || row.expires <= claimedAt) {
        return null;
      }
      row.spentUntil = keepSpentUntil;
      return { identifier: row.identifier };
    },
    claimExpected: async ({ token, identifier, now: claimedAt }) => {
      const row = issued.get(token);
      if (
        !row ||
        row.spentUntil !== null ||
        row.expires <= claimedAt ||
        row.identifier !== identifier
      ) {
        return false;
      }
      issued.delete(token);
      return true;
    },
    hasExpected: async ({ token, identifier, now: checkedAt }) => {
      const row = issued.get(token);
      return Boolean(
        row &&
          row.spentUntil === null &&
          row.expires > checkedAt &&
          row.identifier === identifier,
      );
    },
    findSpent: async ({ token, now: reopenedAt }) => {
      const row = issued.get(token);
      if (!row?.spentUntil || row.spentUntil <= reopenedAt) {
        return null;
      }
      return { identifier: row.identifier };
    },
  };

  const verification = new SignUpVerificationService({
    tokens,
    directory: {
      stateFor: async () => {
        const user = db.user[0];
        if (!user) return "unknown";
        return user.signupConfirmationPending
          ? "awaiting_confirmation"
          : "confirmed";
      },
    },
    mailer: {
      sendVerificationLink: async ({ email: recipient, verificationUrl }) => {
        sentEmail = recipient;
        sentToken = new URL(verificationUrl).searchParams.get("token") ?? "";
      },
    },
    buildVerificationUrl: ({ token }) =>
      `http://localhost:3000/verify?token=${token}`,
    now: () => now,
    mintToken: () => `token-${++tokenSequence}`,
  });

  const endpoint = new SignUpConfirmationEndpoint({
    verification,
    users: {
      findUserIdByEmail: async () => db.user[0]?.id ?? null,
    },
    minter: new BetterAuthSessionMinter(),
  });
  const auth: AuthUnderTest = betterAuth({
    baseURL: "http://localhost:3000",
    secret: "test-secret-test-secret-test-secret",
    database: memoryAdapter(db),
    plugins: [
      signUpConfirmation({
        confirmSignUpAddress: (ctx) => endpoint.confirmSignUpAddress(ctx),
      }),
    ],
  });

  const confirm = (token: string) =>
    auth.handler(
      new Request("http://localhost:3000/api/auth/sign-up/confirm-address", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      }),
    );

  return {
    db,
    email,
    verification,
    confirm,
    sentToken: () => sentToken,
    sentEmail: () => sentEmail,
  };
}

describe("real BetterAuth sign-up confirmation lifecycle", () => {
  /** @scenario "Asking for verification creates no account" */
  it("sends a proof link without creating a user, credential, or session", async () => {
    const harness = buildHarness();

    await harness.verification.requestVerification({ email: harness.email });

    expect(harness.sentEmail()).toBe(harness.email);
    expect(harness.sentToken()).not.toBe("");
    expect(harness.db.user).toHaveLength(0);
    expect(harness.db.account).toHaveLength(0);
    expect(harness.db.session).toHaveLength(0);
  });

  it("refuses an invalid link without changing state or setting a cookie", async () => {
    const harness = buildHarness();
    const before = structuredClone({
      users: harness.db.user,
      accounts: harness.db.account,
      sessions: harness.db.session,
    });

    const response = await harness.confirm("never-issued");

    expect(response.status).toBe(410);
    expect(
      z.object({ error: z.string() }).parse(await response.json()).error,
    ).toBe("identity_verification_expired");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect({
      users: harness.db.user,
      accounts: harness.db.account,
      sessions: harness.db.session,
    }).toEqual(before);
  });

  /** @scenario Opening the link unlocks credential choice */
  it("returns one proof for a fresh address without creating a user or session", async () => {
    const harness = buildHarness();
    await harness.verification.requestVerification({ email: harness.email });
    const token = harness.sentToken();

    const first = await harness.confirm(token);
    const body = z
      .object({
        ...responseSchema.shape,
        addressProof: z.string().nullable(),
      })
      .parse(await first.json());

    expect(first.status).toBe(200);
    expect(first.headers.get("set-cookie")).toBeNull();
    expect(body).toMatchObject({
      email: harness.email,
      accountExists: false,
      addressProof: expect.any(String),
      signedIn: false,
    });
    expect(harness.db.user).toHaveLength(0);
    expect(harness.db.session).toHaveLength(0);
  });

  it("refuses a fresh link when an account is already pending confirmation", async () => {
    const harness = buildHarness({ existingAccount: true });
    await harness.verification.requestVerification({ email: harness.email });

    const response = await harness.confirm(harness.sentToken());

    expect(response.status).toBe(410);
    expect(
      z.object({ error: z.string() }).parse(await response.json()).error,
    ).toBe("identity_verification_expired");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(harness.db.user[0]).toMatchObject({
      emailVerified: false,
      signupConfirmationPending: true,
    });
    expect(harness.db.session).toHaveLength(0);
  });

  /** @scenario Opening a confirmation link a second time confirms, rather than refusing */
  it("returns status only when the fresh proof link is replayed", async () => {
    const harness = buildHarness();
    await harness.verification.requestVerification({ email: harness.email });
    const token = harness.sentToken();

    const first = await harness.confirm(token);
    expect(first.status).toBe(200);

    const replay = await harness.confirm(token);

    expect(replay.status).toBe(200);
    expect(replay.headers.get("set-cookie")).toBeNull();
    expect(
      z
        .object({
          ...responseSchema.shape,
          addressProof: z.string().nullable(),
        })
        .parse(await replay.json()),
    ).toMatchObject({
      accountExists: false,
      addressProof: null,
      signedIn: false,
    });
    expect(harness.db.session).toHaveLength(0);
  });

  /** @scenario Simultaneous confirmation-link consumers yield one proof */
  it("allows only one simultaneous consumer to receive a proof", async () => {
    const harness = buildHarness();
    await harness.verification.requestVerification({ email: harness.email });
    const token = harness.sentToken();

    const responses = await Promise.all([
      harness.confirm(token),
      harness.confirm(token),
    ]);

    expect(responses.every((response) => response.status === 200)).toBe(true);
    const bodies = await Promise.all(
      responses.map(async (response) =>
        z
          .object({
            ...responseSchema.shape,
            addressProof: z.string().nullable(),
          })
          .parse(await response.json()),
      ),
    );
    expect(bodies.filter((body) => body.addressProof !== null)).toHaveLength(1);
    expect(bodies.filter((body) => body.addressProof === null)).toHaveLength(1);
    expect(
      responses.every(
        (response) => response.headers.get("set-cookie") === null,
      ),
    ).toBe(true);
    expect(harness.db.user).toHaveLength(0);
    expect(harness.db.session).toHaveLength(0);
  });
});
