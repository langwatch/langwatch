import { compare, hash } from "bcrypt";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { describe, expect, it } from "vitest";
import { models } from "../config/models";
import { createSessionGateHooks } from "./support/session-gate";

type Row = Record<string, unknown>;

describe("real BetterAuth pending sign-up session gate", () => {
  /** @scenario Pending password sign-in cannot mint a session */
  it("blocks pending credentials but preserves legacy unverified sign-in", async () => {
    const email = "pending-password@example.com";
    const password = "password-123";
    const userId = "pending-password-user";
    const now = new Date();
    const users: Row[] = [
      {
        id: userId,
        name: "Pending Password",
        email,
        emailVerified: false,
        signupConfirmationPending: true,
        createdAt: now,
        updatedAt: now,
      },
    ];
    const sessions: Row[] = [];
    const hooks = createSessionGateHooks({
      findUser: async () => {
        const user = users[0];
        if (!user) {
          return null;
        }

        return {
          deactivatedAt:
            user.deactivatedAt instanceof Date ? user.deactivatedAt : null,
          signupConfirmationPending: user.signupConfirmationPending === true,
        };
      },
    });
    const db: Record<string, Row[]> = {
      User: users,
      Account: [
        {
          id: "credential-account",
          userId,
          type: "credential",
          provider: "credential",
          issuer: "local:credential",
          providerAccountId: userId,
          password: await hash(password, 4),
          createdAt: now,
          updatedAt: now,
        },
      ],
      Session: sessions,
      VerificationToken: [],
    };
    const auth = betterAuth({
      baseURL: "http://localhost:3000",
      secret: "test-secret-test-secret-test-secret",
      database: memoryAdapter(db),
      ...models(),
      emailAndPassword: {
        enabled: true,
        password: {
          hash: async (candidate) => hash(candidate, 4),
          verify: async ({ password: candidate, hash: stored }) =>
            compare(candidate, stored),
        },
      },
      databaseHooks: {
        session: {
          create: {
            before: async (session) => {
              const permitted = await hooks.beforeSessionCreate({
                session: { userId: session.userId },
              });
              return permitted === false ? false : void 0;
            },
          },
        },
      },
    });
    const signIn = () =>
      auth.handler(
        new Request("http://localhost:3000/api/auth/sign-in/email", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email, password }),
        }),
      );

    const pending = await signIn();
    expect(pending.status).toBe(401);
    await expect(pending.json()).resolves.toMatchObject({
      code: "FAILED_TO_CREATE_SESSION",
    });
    expect(pending.headers.get("set-cookie")).toBeNull();
    expect(sessions).toHaveLength(0);

    const user = users[0];
    if (!user) {
      throw new Error("fixture user missing");
    }
    user.signupConfirmationPending = false;
    const legacy = await signIn();
    expect(legacy.status).toBe(200);
    expect(legacy.headers.get("set-cookie")).toContain("session_token");
    expect(sessions).toHaveLength(1);
  });
});
