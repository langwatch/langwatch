/** @vitest-environment node */
import { createHash, randomBytes } from "node:crypto";
import {
  type IdentifierFact,
  type IdentityFact,
  reduceIdentity,
} from "@langwatch/identity";
import {
  type IdentityLedger,
  IdentityService,
  VerificationCeremonyService,
} from "@langwatch/identity-server";
import { nanoid } from "nanoid";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "~/server/db";
import { createTenantId } from "~/server/event-sourcing";

import { AccountIdentifiersService } from "../account-identifiers.service";
import { buildAddressConfirmationUrl } from "../address-confirmation-link";
import { PrismaIdentityHeadsRepository } from "../repositories/identity-heads.prisma.repository";
import { PrismaIdentityProjectionRepository } from "../repositories/identity-projection.prisma.repository";
import { PrismaIdentityReservationRepository } from "../repositories/identity-reservations.prisma.repository";
import { PrismaIdentityVerificationRepository } from "../repositories/identity-verification.prisma.repository";
import { identityGuards } from "../runtime";

/**
 * An account that already exists and never confirmed its own address,
 * confirming it from Settings.
 *
 * Everything is the real thing against Postgres: the guards, the reducer,
 * the ceremony, the heads and the fold's store. The one stand-in is the
 * queue between a command and its fold, replaced by a ledger that folds the
 * facts into the real store on the spot.
 *
 * Spec: specs/identity/authentication-settings.feature
 */

const namespace = `ownaddr-${nanoid(8).toLowerCase()}`;
const USER = `${namespace}-user`;
const EMAIL = `${namespace}@acme.test`;
const IDENTIFIER = `${namespace}-email`;

const reservations = new PrismaIdentityReservationRepository(prisma);
const projections = new PrismaIdentityProjectionRepository(
  prisma,
  reservations,
);
const heads = new PrismaIdentityHeadsRepository(prisma);

/** Folds each committed fact into the real projection store at once. */
const foldingLedger: IdentityLedger = {
  commit: async ({ facts }) => {
    const context = { aggregateId: USER, tenantId: createTenantId(USER) };
    const stored = await projections.load(USER, context);
    if (!stored) throw new Error("the user was seeded with a projection");
    const stamped = facts.map(
      (fact) => ({ ...fact, occurredAt: Date.now() }) as IdentityFact,
    );
    let state = stored.state;
    for (const fact of stamped) {
      state = { ...state, ...reduceIdentity({ heads: state, fact }) };
    }
    await projections.store(
      {
        ...stored,
        state,
        cursor: { acceptedAt: Date.now(), eventId: `evt_${nanoid()}` },
      },
      context,
    );
    return stamped;
  },
};

const ceremony = new VerificationCeremonyService(
  new PrismaIdentityVerificationRepository(prisma),
  heads,
  new IdentityService(identityGuards(), foldingLedger),
  { isLatched: async () => true },
);

const sent: { email: string; verificationUrl: string }[] = [];
const service = new AccountIdentifiersService({
  heads,
  identity: new IdentityService(identityGuards(), foldingLedger),
  ceremony,
  deps: {
    sendConfirmation: async (mail) => {
      sent.push(mail);
    },
    buildConfirmationUrl: buildAddressConfirmationUrl,
    newCommandId: () => `cmd_${nanoid()}`,
    now: () => Date.now(),
  },
});

function pkce() {
  const codeVerifier = randomBytes(32).toString("base64url");
  const codeChallenge = createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");
  return { codeVerifier, codeChallenge };
}

/** The account as an older release left it: a password sign-up whose
 *  address was never confirmed, adopted by the backfill as ATTACHED. */
async function seedUnconfirmedAccount() {
  await prisma.user.create({
    data: { id: USER, email: EMAIL, emailVerified: false },
  });
  const attached: IdentifierFact = {
    identifierId: IDENTIFIER,
    userId: USER,
    provider: "email",
    value: EMAIL,
    domain: "acme.test",
    identifierHash: null,
    accountId: null,
    providerId: null,
    issuer: null,
    providerAccountId: null,
    connectionId: null,
    state: "ATTACHED",
    verifiedAtMs: null,
    attachedAtMs: Date.now() - 60_000,
    detachedAtMs: null,
  } as IdentifierFact;
  await projections.store(
    {
      state: {
        userId: USER,
        identifiers: { [IDENTIFIER]: attached },
        CreatedAt: 1,
        UpdatedAt: 1,
        LastEventOccurredAt: 1,
      },
      cursor: { acceptedAt: 1, eventId: "evt_seed" },
      occurredAt: 1,
      createdAt: 1,
      updatedAt: 1,
      version: "2026-08-20",
    },
    { aggregateId: USER, tenantId: createTenantId(USER) },
  );
}

function linkParams() {
  const mail = sent.at(-1);
  if (!mail) throw new Error("no confirmation was mailed");
  const params = new URL(mail.verificationUrl).searchParams;
  return {
    identifierId: params.get("confirm") ?? "",
    verificationId: params.get("verification") ?? "",
    token: params.get("token") ?? "",
  };
}

const emailVerified = async () =>
  (
    await prisma.user.findUniqueOrThrow({
      where: { id: USER },
      select: { emailVerified: true },
    })
  ).emailVerified;

beforeEach(async () => {
  sent.length = 0;
  await seedUnconfirmedAccount();
});

afterEach(async () => {
  await prisma.verificationToken.deleteMany({
    where: { identifier: { contains: IDENTIFIER } },
  });
  await prisma.identifierReservation.deleteMany({ where: { userId: USER } });
  await prisma.identifier.deleteMany({ where: { userId: USER } });
  await prisma.identityProjectionCursor.deleteMany({ where: { userId: USER } });
  await prisma.user.deleteMany({ where: { id: USER } });
});

describe("an existing account whose own address was never confirmed", () => {
  describe("when it asks from Settings and opens the link in the window that asked", () => {
    /** @scenario "An existing unconfirmed account confirms its own address from Settings" */
    it("confirms the address and marks the account's address confirmed", async () => {
      const { codeVerifier, codeChallenge } = pkce();

      const { identifierId } = await service.sendOwnAddressConfirmation({
        userId: USER,
        email: EMAIL.toUpperCase(),
        codeChallenge,
      });

      expect(identifierId).toBe(IDENTIFIER);
      expect(sent).toHaveLength(1);
      expect(sent[0]?.email).toBe(EMAIL);
      const link = linkParams();
      expect(link.identifierId).toBe(IDENTIFIER);

      await ceremony.completeEmailVerification({
        userId: USER,
        ...link,
        codeVerifier,
      });

      const head = await heads.findIdentifier({
        userId: USER,
        identifierId: IDENTIFIER,
      });
      expect(head?.state).toBe("VERIFIED");
      // The column better-auth's account linking reads.
      expect(await emailVerified()).toBe(true);
    });
  });

  describe("when the mailed link is used without the window that asked", () => {
    /** @scenario "The own address link opened without the window that asked confirms nothing" */
    it("confirms nothing", async () => {
      const { codeChallenge } = pkce();
      await service.sendOwnAddressConfirmation({
        userId: USER,
        email: EMAIL,
        codeChallenge,
      });

      await expect(
        ceremony.completeEmailVerification({
          userId: USER,
          ...linkParams(),
          codeVerifier: pkce().codeVerifier,
        }),
      ).rejects.toMatchObject({ code: "identity_verification_invalid" });

      const head = await heads.findIdentifier({
        userId: USER,
        identifierId: IDENTIFIER,
      });
      expect(head?.state).toBe("ATTACHED");
      expect(await emailVerified()).toBe(false);
    });
  });

  describe("when the own address is already confirmed", () => {
    /** @scenario "An own address that is already confirmed is not confirmed again" */
    it("sends nothing and says it cannot be confirmed again", async () => {
      const { codeVerifier, codeChallenge } = pkce();
      await service.sendOwnAddressConfirmation({
        userId: USER,
        email: EMAIL,
        codeChallenge,
      });
      await ceremony.completeEmailVerification({
        userId: USER,
        ...linkParams(),
        codeVerifier,
      });
      sent.length = 0;

      await expect(
        service.sendOwnAddressConfirmation({
          userId: USER,
          email: EMAIL,
          codeChallenge: pkce().codeChallenge,
        }),
      ).rejects.toMatchObject({ code: "identity_identifier_not_verifiable" });
      expect(sent).toHaveLength(0);
    });
  });

  describe("when no identifier of the account carries its own address", () => {
    /** @scenario "An own address the account is not known by sends nothing" */
    it("sends nothing and says the address was not found", async () => {
      await expect(
        service.sendOwnAddressConfirmation({
          userId: USER,
          email: "someone-else@acme.test",
          codeChallenge: pkce().codeChallenge,
        }),
      ).rejects.toMatchObject({ code: "identity_identifier_not_found" });
      expect(sent).toHaveLength(0);
    });
  });
});
