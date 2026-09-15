import { createHash } from "node:crypto";
import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { models } from "../config/models";
import { beforeSessionCreate } from "../hooks";
import {
  PASSKEY_SIGNUP_EMAIL_TAKEN,
  type PasskeySignUpAddressHolder,
  PasskeySignUpRegistration,
} from "../passkey-signup";

vi.mock("~/env.mjs", () => ({
  env: { NEXTAUTH_SECRET: "passkey-proof-first-test-secret" },
}));

// `~/server/users/credential-user` is deliberately NOT mocked. It holds
// `belongsToSomebody`, which is the decision the registration guard makes —
// half-made ceremony wreckage, let them retry, against somebody else's
// account, refuse — and it holds `PasskeySignUpAddressTakenError`, which the
// write path maps to a refusal by `instanceof`. Standing either one in would
// disarm the predicate this file is the only place that exercises against a
// real plugin, and a bare `class extends Error {}` would break the mapping
// outright. The module is framework-free and store-free (its own header says
// so), so there is nothing to isolate from. The sibling
// `passkey-signup.unit.test.ts` states the same rule for the same reason.

type Row = Record<string, unknown>;

const join = (...parts: Uint8Array[]) => {
  const result = new Uint8Array(
    parts.reduce((length, part) => length + part.length, 0),
  );
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
};

const cborLength = (major: number, length: number) => {
  if (length < 24) {
    return Uint8Array.of((major << 5) | length);
  }
  if (length < 256) {
    return Uint8Array.of((major << 5) | 24, length);
  }
  return Uint8Array.of((major << 5) | 25, length >> 8, length & 0xff);
};

const cbor = (
  value: string | number | Uint8Array | Map<unknown, unknown>,
): Uint8Array => {
  if (typeof value === "number") {
    return value >= 0 ? cborLength(0, value) : cborLength(1, -1 - value);
  }
  if (typeof value === "string") {
    const bytes = new TextEncoder().encode(value);
    return join(cborLength(3, bytes.length), bytes);
  }
  if (value instanceof Uint8Array) {
    return join(cborLength(2, value.length), value);
  }
  const entries = [...value.entries()];
  return join(
    cborLength(5, entries.length),
    ...entries.flatMap(([key, entry]) => [
      cbor(key as string | number | Uint8Array | Map<unknown, unknown>),
      cbor(entry as string | number | Uint8Array | Map<unknown, unknown>),
    ]),
  );
};

const registrationResponse = ({ challenge }: { challenge: string }) => {
  const credentialId = new TextEncoder().encode("test-credential-id");
  const coordinate = new Uint8Array(32).fill(1);
  const coseKey = cbor(
    new Map<unknown, unknown>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, coordinate],
      [-3, coordinate],
    ]),
  );
  const rpIdHash = createHash("sha256").update("localhost").digest();
  const authenticatorData = join(
    rpIdHash,
    Uint8Array.of(0x45),
    new Uint8Array(4),
    new Uint8Array(16),
    Uint8Array.of(0, credentialId.length),
    credentialId,
    coseKey,
  );
  const attestationObject = cbor(
    new Map<unknown, unknown>([
      ["fmt", "none"],
      ["attStmt", new Map()],
      ["authData", authenticatorData],
    ]),
  );
  const clientDataJSON = new TextEncoder().encode(
    JSON.stringify({
      type: "webauthn.create",
      challenge,
      origin: "http://localhost:3000",
    }),
  );
  const id = Buffer.from(credentialId).toString("base64url");

  return {
    id,
    rawId: id,
    type: "public-key",
    response: {
      clientDataJSON: Buffer.from(clientDataJSON).toString("base64url"),
      attestationObject: Buffer.from(attestationObject).toString("base64url"),
      transports: ["internal"],
    },
    clientExtensionResults: {},
    authenticatorAttachment: "platform",
  };
};

describe("real BetterAuth proof-first passkey enrollment", () => {
  it("consumes the mailbox proof before creating the account and session", async () => {
    const userId = "verified-passkey-user";
    const email = "verified-passkey@example.com";
    const now = new Date();
    const users: Row[] = [
      {
        id: userId,
        name: email,
        email,
        emailVerified: true,
        signupConfirmationPending: false,
        createdAt: now,
        updatedAt: now,
      },
    ];
    const sessions: Row[] = [];
    const db: Record<string, Row[]> = {
      User: users,
      Account: [],
      Session: sessions,
      VerificationToken: [],
      passkey: [],
    };
    let proofIsLive = false;
    const registration = new PasskeySignUpRegistration({
      eligibility: { isAllowed: async () => true },
      directory: { findAddressHolder: async () => null },
      accounts: {
        createPasskeyUser: async () => ({ id: userId, created: true }),
      },
      verification: {
        validateAddressProof: async () => proofIsLive,
        claimAddressProof: async () => {
          if (!proofIsLive) return false;
          proofIsLive = false;
          return true;
        },
      },
    });
    const auth = betterAuth({
      baseURL: "http://localhost:3000",
      secret: "test-secret-test-secret-test-secret",
      database: memoryAdapter(db),
      ...models(),
      databaseHooks: {
        session: {
          create: {
            before: async (session) => {
              const permitted = await beforeSessionCreate({
                prisma: {
                  user: {
                    findUnique: async () => ({
                      deactivatedAt: null,
                      signupConfirmationPending: false,
                    }),
                  },
                },
                session: { userId: session.userId },
              });
              return permitted === false ? false : void 0;
            },
          },
        },
      },
      plugins: [
        passkey({
          rpName: "LangWatch",
          registration: {
            requireSession: false,
            resolveUser: (args) => registration.resolveUser(args),
            afterVerification: (args) => registration.afterVerification(args),
          },
        }),
      ],
    });

    const context = encodeURIComponent(
      JSON.stringify({
        email,
        claim: "a".repeat(43),
        addressProof: "mailbox-proof",
      }),
    );
    const deniedOptions = await auth.handler(
      new Request(
        `http://localhost:3000/api/auth/passkey/generate-register-options?context=${context}`,
        { headers: { origin: "http://localhost:3000" } },
      ),
    );
    expect(deniedOptions.status).toBe(403);
    expect(db.passkey).toHaveLength(0);
    expect(db.Session).toHaveLength(0);

    proofIsLive = true;
    const options = await auth.handler(
      new Request(
        `http://localhost:3000/api/auth/passkey/generate-register-options?context=${context}`,
        { headers: { origin: "http://localhost:3000" } },
      ),
    );
    expect(options.status).toBe(200);
    const challengeCookie = options.headers.get("set-cookie");
    expect(challengeCookie).not.toBeNull();
    const challenge = z
      .object({ challenge: z.string() })
      .parse(await options.json()).challenge;

    const verification = await auth.handler(
      new Request(
        "http://localhost:3000/api/auth/passkey/verify-registration",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: challengeCookie ?? "",
            origin: "http://localhost:3000",
          },
          body: JSON.stringify({
            response: registrationResponse({ challenge }),
            createSession: true,
          }),
        },
      ),
    );

    const verificationBody: unknown = await verification.json();
    expect({ status: verification.status, body: verificationBody }).toEqual({
      status: 200,
      body: expect.any(Object),
    });
    expect(proofIsLive).toBe(false);
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({
      emailVerified: true,
      signupConfirmationPending: false,
    });
    expect(db.passkey).toHaveLength(1);
    expect(db.Session).toHaveLength(1);
  });
});

/**
 * The taken-address guard, driven through the real plugin.
 *
 * `belongsToSomebody` is the line between "an earlier ceremony died and this
 * person should get their address back" and "this is somebody else's account,
 * refuse" — and the whole point of this file is that it is the one place the
 * real plugin, the real attestation check and the real predicate meet. So the
 * predicate is exercised here on both of its answers, over the rows a
 * directory really returns, rather than being taken on trust from a stand-in.
 */
describe("the taken-address guard, through the real plugin", () => {
  const guardedOptions = async (
    holder: PasskeySignUpAddressHolder | null,
  ): Promise<Response> => {
    const email = "guarded@example.com";
    const db: Record<string, Row[]> = {
      User: [],
      Account: [],
      Session: [],
      VerificationToken: [],
      passkey: [],
    };
    const registration = new PasskeySignUpRegistration({
      eligibility: { isAllowed: async () => true },
      directory: { findAddressHolder: async () => holder },
      accounts: {
        createPasskeyUser: async () => ({ id: "unused", created: true }),
      },
      verification: {
        validateAddressProof: async () => true,
        claimAddressProof: async () => true,
      },
    });
    const auth = betterAuth({
      baseURL: "http://localhost:3000",
      secret: "test-secret-test-secret-test-secret",
      database: memoryAdapter(db),
      ...models(),
      plugins: [
        passkey({
          rpName: "LangWatch",
          registration: {
            requireSession: false,
            resolveUser: (args) => registration.resolveUser(args),
            afterVerification: (args) => registration.afterVerification(args),
          },
        }),
      ],
    });
    const context = encodeURIComponent(
      JSON.stringify({
        email,
        claim: "a".repeat(43),
        addressProof: "mailbox-proof",
      }),
    );
    return auth.handler(
      new Request(
        `http://localhost:3000/api/auth/passkey/generate-register-options?context=${context}`,
        { headers: { origin: "http://localhost:3000" } },
      ),
    );
  };

  describe("given an address whose account holds no way to sign in", () => {
    describe("when a passkey sign-up arrives for it", () => {
      it("lets the ceremony open rather than burning the address", async () => {
        // Exactly what a sign-up that died between the account write and the
        // browser prompt leaves behind: a row, and nothing on it anybody
        // could present. Refusing this is how an address becomes permanently
        // unusable by the person who owns it.
        const options = await guardedOptions({
          id: "wreckage-user",
          accounts: [],
          accountCredentials: [],
          passkeys: [],
          orgMemberships: [],
        });

        expect(options.status).toBe(200);
      });
    });
  });

  describe("given an address somebody actually holds", () => {
    describe("when a passkey sign-up arrives for it", () => {
      it("refuses it in the taken-address vocabulary", async () => {
        const options = await guardedOptions({
          id: "real-user",
          accounts: [{ provider: "credential", password: "argon2-hash" }],
          accountCredentials: [],
          passkeys: [],
          orgMemberships: [],
        });
        const body = (await options.json()) as { code?: string };

        // The code the sign-up screen watches for to turn itself into the
        // log-in screen. A different one, or a bare failure, and the person
        // is told nothing they can act on.
        expect(options.status).toBe(400);
        expect(body.code).toBe(PASSKEY_SIGNUP_EMAIL_TAKEN);
      });
    });
  });

  describe("given an account whose only rows are a membership", () => {
    describe("when a passkey sign-up arrives for it", () => {
      it("still refuses, because membership makes the account somebody's", async () => {
        const options = await guardedOptions({
          id: "member-user",
          accounts: [],
          accountCredentials: [],
          passkeys: [],
          orgMemberships: [{ organizationId: "org-1" }],
        });
        const body = (await options.json()) as { code?: string };

        expect(options.status).toBe(400);
        expect(body.code).toBe(PASSKEY_SIGNUP_EMAIL_TAKEN);
      });
    });
  });
});
