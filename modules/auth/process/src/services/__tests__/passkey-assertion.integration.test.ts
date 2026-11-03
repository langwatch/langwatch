/**
 * A passkey signature over one caller-chosen challenge, against real `Passkey` rows, signed by a
 * software authenticator. @see specs/identity/passkeys.feature
 */
import { createHash, generateKeyPairSync, randomUUID, sign, type KeyObject } from "node:crypto";

import type { PasskeyAssertionResponse } from "@langwatch/auth-contract";
import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
  type PrismaConnection,
} from "@langwatch/prisma-client";
import { isoCBOR } from "@simplewebauthn/server/helpers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaPasskeyRepository } from "../../repositories/prisma/prisma.passkey.repository.ts";
import { PasskeyAssertionService } from "../passkey-assertion.service.ts";

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL;
const namespace = `test-passkey-assertion-${randomUUID()}`;
const samId = `${namespace}-sam`;
const alexId = `${namespace}-alex`;
const samSessionId = `${namespace}-sam-session`;
const SESSION_URL = "https://app.langwatch.example";
const RP_ID = "app.langwatch.example";

const USER_PRESENT = 0x01;
const USER_VERIFIED = 0x04;

/** A P-256 authenticator held in the test: it signs exactly what a browser would hand back. */
class SoftwareAuthenticator {
  readonly credentialId = Buffer.from(randomUUID()).toString("base64url");
  private readonly privateKey: KeyObject;
  readonly cosePublicKey: string;
  private counter = 0;

  constructor() {
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    this.privateKey = privateKey;
    const jwk = publicKey.export({ format: "jwk" });
    const cose = new Map<number, number | Uint8Array>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, Buffer.from(jwk.x ?? "", "base64url")],
      [-3, Buffer.from(jwk.y ?? "", "base64url")],
    ]);
    this.cosePublicKey = Buffer.from(isoCBOR.encode(cose)).toString("base64");
  }

  assert({
    challenge,
    userVerified = true,
    origin = SESSION_URL,
  }: {
    challenge: string;
    userVerified?: boolean;
    origin?: string;
  }): PasskeyAssertionResponse {
    this.counter += 1;
    const counter = Buffer.alloc(4);
    counter.writeUInt32BE(this.counter);
    const authenticatorData = Buffer.concat([
      createHash("sha256").update(RP_ID).digest(),
      Buffer.from([USER_PRESENT | (userVerified ? USER_VERIFIED : 0)]),
      counter,
    ]);
    const clientDataJSON = Buffer.from(
      JSON.stringify({ type: "webauthn.get", challenge, origin, crossOrigin: false }),
    );
    const signature = sign(
      "sha256",
      Buffer.concat([authenticatorData, createHash("sha256").update(clientDataJSON).digest()]),
      this.privateKey,
    );
    return {
      id: this.credentialId,
      rawId: this.credentialId,
      type: "public-key",
      response: {
        clientDataJSON: clientDataJSON.toString("base64url"),
        authenticatorData: authenticatorData.toString("base64url"),
        signature: signature.toString("base64url"),
      },
      clientExtensionResults: {},
    };
  }
}

function freshChallenge(): string {
  return createHash("sha256").update(randomUUID()).digest("base64url");
}

describe.skipIf(!databaseUrl)("PasskeyAssertionService over Postgres", () => {
  let connection: PrismaConnection;
  let service: PasskeyAssertionService;
  const samKey = new SoftwareAuthenticator();
  const alexKey = new SoftwareAuthenticator();

  const counterOf = async (credentialId: string) =>
    (
      await connection.client.passkey.findFirstOrThrow({
        where: { credentialID: credentialId },
        select: { counter: true },
      })
    ).counter;

  beforeAll(async () => {
    if (!databaseUrl) throw new Error("Test database URL is required");
    connection = PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
      logger: createLogger("langwatch:auth:test:passkey-assertion"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }));
    const prisma = connection.client;
    service = PasskeyAssertionService.create({
      passkeys: PrismaPasskeyRepository.create(prisma),
      relyingParty: () =>
        PasskeyAssertionService.relyingPartyFor({
          sessionUrl: SESSION_URL,
          publicBaseUrl: SESSION_URL,
        }),
    });

    for (const id of [samId, alexId]) {
      await prisma.user.create({ data: { id, email: `${id}@example.com`, name: id } });
    }
    for (const [userId, key] of [
      [samId, samKey],
      [alexId, alexKey],
    ] as const) {
      await prisma.passkey.create({
        data: {
          userId,
          credentialID: key.credentialId,
          publicKey: key.cosePublicKey,
          counter: 0,
          deviceType: "singleDevice",
          transports: "internal,hybrid",
        },
      });
    }
    await prisma.session.create({
      data: {
        id: samSessionId,
        sessionToken: `${namespace}-token`,
        userId: samId,
        expires: new Date("2030-01-01T00:00:00.000Z"),
        amr: ["pwd"],
      },
    });
  });

  afterAll(async () => {
    if (!connection) return;
    await connection.client.session.deleteMany({ where: { userId: { in: [samId, alexId] } } });
    await connection.client.passkey.deleteMany({ where: { userId: { in: [samId, alexId] } } });
    await connection.client.user.deleteMany({ where: { id: { in: [samId, alexId] } } });
    await connection.closeOnce();
  });

  describe("when asked for request options", () => {
    it("lists only the person's own passkeys and requires user verification", async () => {
      const challenge = freshChallenge();

      await expect(service.hasPasskey({ userId: samId })).resolves.toBe(true);
      await expect(service.options({ userId: samId, challenge })).resolves.toEqual({
        challenge,
        rpId: RP_ID,
        timeout: 60_000,
        userVerification: "required",
        allowCredentials: [
          { id: samKey.credentialId, type: "public-key", transports: ["internal", "hybrid"] },
        ],
      });
    });

    it("refuses a person who holds no passkey", async () => {
      await expect(service.hasPasskey({ userId: `${namespace}-unregistered` })).resolves.toBe(
        false,
      );
      await expect(
        service.options({ userId: `${namespace}-unregistered`, challenge: freshChallenge() }),
      ).rejects.toMatchObject({
        code: "passkey_assertion_refused",
        meta: { reason: "unknown_credential" },
      });
    });
  });

  describe("when the person signs the challenge with user verification", () => {
    /** @scenario "A passkey signs one challenge with user verification" */
    /** @scenario "Approving one request with a passkey leaves the session as it was" */
    it("verifies, names the passkey and moves its counter forward", async () => {
      const challenge = freshChallenge();
      const before = await counterOf(samKey.credentialId);

      await expect(
        service.verify({ userId: samId, challenge, response: samKey.assert({ challenge }) }),
      ).resolves.toEqual({ credentialId: samKey.credentialId });

      expect(await counterOf(samKey.credentialId)).toBeGreaterThan(before);
      const session = await connection.client.session.findUniqueOrThrow({
        where: { id: samSessionId },
        select: { amr: true, actorUserId: true, impersonationExpiresAt: true },
      });
      expect(session).toEqual({ amr: ["pwd"], actorUserId: null, impersonationExpiresAt: null });
    });
  });

  describe("when the authenticator did not verify the person", () => {
    /** @scenario "A signature without user verification is refused" */
    it("refuses as user_verification_missing", async () => {
      const challenge = freshChallenge();

      await expect(
        service.verify({
          userId: samId,
          challenge,
          response: samKey.assert({ challenge, userVerified: false }),
        }),
      ).rejects.toMatchObject({
        code: "passkey_assertion_refused",
        meta: { reason: "user_verification_missing" },
      });
    });
  });

  describe("when the signature was made over another challenge", () => {
    /** @scenario "A signature over a different challenge is refused" */
    it("refuses as bad_signature and leaves the counter", async () => {
      const before = await counterOf(samKey.credentialId);

      await expect(
        service.verify({
          userId: samId,
          challenge: freshChallenge(),
          response: samKey.assert({ challenge: freshChallenge() }),
        }),
      ).rejects.toMatchObject({
        code: "passkey_assertion_refused",
        meta: { reason: "bad_signature" },
      });
      expect(await counterOf(samKey.credentialId)).toBe(before);
    });

    it("refuses a signature made for another origin as bad_signature", async () => {
      const challenge = freshChallenge();

      await expect(
        service.verify({
          userId: samId,
          challenge,
          response: samKey.assert({ challenge, origin: "https://phish.example" }),
        }),
      ).rejects.toMatchObject({ meta: { reason: "bad_signature" } });
    });
  });

  describe("when the passkey belongs to someone else", () => {
    /** @scenario "Another person's passkey does not approve for them" */
    it("refuses as wrong_user", async () => {
      const challenge = freshChallenge();

      await expect(
        service.verify({ userId: samId, challenge, response: alexKey.assert({ challenge }) }),
      ).rejects.toMatchObject({
        code: "passkey_assertion_refused",
        meta: { reason: "wrong_user" },
      });
    });
  });

  describe("when no account holds the credential", () => {
    /** @scenario "An unregistered passkey is refused" */
    it("refuses as unknown_credential", async () => {
      const challenge = freshChallenge();
      const stranger = new SoftwareAuthenticator();

      await expect(
        service.verify({ userId: samId, challenge, response: stranger.assert({ challenge }) }),
      ).rejects.toMatchObject({
        code: "passkey_assertion_refused",
        meta: { reason: "unknown_credential" },
      });
    });
  });
});
