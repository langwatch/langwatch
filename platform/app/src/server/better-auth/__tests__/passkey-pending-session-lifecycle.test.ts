import { createHash } from "node:crypto";
import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { models } from "../config/models";
import { beforeSessionCreate } from "../hooks";

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

describe("real BetterAuth pending passkey session gate", () => {
  /** @scenario Client session flags cannot bypass address confirmation */
  it("refuses a forged createSession request for a pending passkey account", async () => {
    const userId = "pending-passkey-user";
    const now = new Date();
    const users: Row[] = [
      {
        id: userId,
        name: "Pending Passkey",
        email: "pending-passkey@example.com",
        emailVerified: false,
        signupConfirmationPending: true,
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
                      signupConfirmationPending: true,
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
            resolveUser: async () => ({
              id: userId,
              name: "pending-passkey@example.com",
              displayName: "Pending Passkey",
            }),
            afterVerification: async () => ({ userId }),
          },
        }),
      ],
    });

    const options = await auth.handler(
      new Request(
        "http://localhost:3000/api/auth/passkey/generate-register-options",
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

    expect(verification.status).toBe(500);
    expect(
      z.object({ code: z.string() }).parse(await verification.json()).code,
    ).toBe("UNABLE_TO_CREATE_SESSION");
    expect(verification.headers.get("set-cookie")).toBeNull();
    expect(sessions).toHaveLength(0);
  });
});
