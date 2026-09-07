import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { z } from "zod";
import { describe, expect, it } from "vitest";
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
type MemoryDB = Record<string, Row[]>;

const responseSchema = z.object({
  email: z.string(),
  accountExists: z.boolean(),
  signedIn: z.boolean(),
});

function buildHarness() {
  const email = "pending@example.com";
  const userId = "pending-user";
  const now = new Date("2026-09-07T08:00:00.000Z");
  const db: MemoryDB = {
    user: [
      {
        id: userId,
        name: "Pending User",
        email,
        emailVerified: false,
        signupConfirmationPending: true,
        createdAt: now,
        updatedAt: now,
      },
    ],
    session: [],
    account: [],
    verification: [],
  };
  const issued = new Map<
    string,
    { identifier: string; expires: Date; spentUntil: Date | null }
  >();
  let sentToken = "";
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
      stateFor: async () =>
        db.user[0]?.signupConfirmationPending
          ? "awaiting_confirmation"
          : "confirmed",
    },
    accounts: {
      createCredentialAccount: async () => {},
      markAddressConfirmed: async () => {
        const user = db.user[0];
        if (user) {
          user.emailVerified = true;
          user.signupConfirmationPending = false;
        }
      },
    },
    mailer: {
      sendVerificationLink: async ({ verificationUrl }) => {
        sentToken = new URL(verificationUrl).searchParams.get("token") ?? "";
      },
    },
    buildVerificationUrl: ({ token }) =>
      `http://localhost:3000/verify?token=${token}`,
    now: () => now,
    mintToken: () => `token-${++tokenSequence}`,
  });

  let auth: ReturnType<typeof betterAuth>;
  const endpoint = new SignUpConfirmationEndpoint({
    verification,
    users: { findUserIdByEmail: async () => userId },
    minter: new BetterAuthSessionMinter(),
  });
  auth = betterAuth({
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
  };
}

describe("real BetterAuth sign-up confirmation lifecycle", () => {
  /** @scenario Opening the link is what signs me in for the first time */
  /** @scenario Opening a confirmation link a second time confirms, rather than refusing */
  it("mints only on the fresh claim and never on replay or invalid proof", async () => {
    const harness = buildHarness();
    await harness.verification.requestVerification({ email: harness.email });
    const token = harness.sentToken();

    const beforeInvalid = structuredClone({
      users: harness.db.user,
      sessions: harness.db.session,
    });
    const invalid = await harness.confirm("never-issued");
    expect(
      z.object({ error: z.string() }).parse(await invalid.json()).error,
    ).toBe("identity_verification_expired");
    expect(invalid.headers.get("set-cookie")).toBeNull();
    expect(
      structuredClone({
        users: harness.db.user,
        sessions: harness.db.session,
      }),
    ).toEqual(beforeInvalid);

    const first = await harness.confirm(token);

    expect(first.status).toBe(200);
    expect(first.headers.get("set-cookie")).toContain("session_token");
    expect(responseSchema.parse(await first.json())).toMatchObject({
      email: harness.email,
      accountExists: true,
      signedIn: true,
    });
    expect(harness.db.session).toHaveLength(1);
    expect(harness.db.user[0]).toMatchObject({
      emailVerified: true,
      signupConfirmationPending: false,
    });

    harness.db.session = [];
    const replay = await harness.confirm(token);

    expect(replay.status).toBe(200);
    expect(replay.headers.get("set-cookie")).toBeNull();
    expect(responseSchema.parse(await replay.json()).signedIn).toBe(false);
    expect(harness.db.session).toHaveLength(0);
  });

  /** @scenario Simultaneous confirmation-link consumers mint one session */
  it("allows only one simultaneous consumer to mint a session", async () => {
    const harness = buildHarness();
    await harness.verification.requestVerification({ email: harness.email });
    const token = harness.sentToken();

    const responses = await Promise.all([
      harness.confirm(token),
      harness.confirm(token),
    ]);

    expect(
      responses.filter((response) => response.headers.has("set-cookie")),
    ).toHaveLength(1);
    const bodies = await Promise.all(
      responses.map(async (response) =>
        responseSchema.parse(await response.json()),
      ),
    );
    expect(bodies.filter((body) => body.signedIn)).toHaveLength(1);
    expect(harness.db.session).toHaveLength(1);
  });
});
