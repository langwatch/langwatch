import { nanoid } from "nanoid";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "~/server/db";
import { PrismaSsoMembershipRepository } from "../sso-membership.prisma.repository";

/**
 * The setup-administrator exemption, against real Postgres.
 *
 * AGAINST A REAL DATABASE ON PURPOSE, and it is the whole point of this file.
 * This read was written as one query with a nested `user.identifiers.some`
 * filter — a relation that does not exist, because `Identifier` carries a
 * bare `userId` with deliberately no foreign key. Prisma rejects it outright,
 * so the call THREW rather than answering, `@better-auth/sso` caught it in a
 * bare `catch {}` and answered `SSO_USER_RESOLUTION_FAILED` with the cause
 * discarded, and a customer saw "something went wrong signing you in".
 *
 * A test with a faked Prisma would have accepted the impossible filter and
 * passed. Only a real client rejects it, which is why the whole suite talks to
 * one.
 *
 * Spec: specs/identity/sso-activation.feature.
 */
const namespace = `ssoreg-${nanoid(8)}`;
const ORGANIZATION = `${namespace}-org`;
const REGISTRANT = `${namespace}-registrant`;
const COLLEAGUE = `${namespace}-colleague`;
// Lower-case, because that is how the projection stores an identifier's
// value — NFKC, trimmed and folded. Seeding a mixed-case value here would be
// testing a row the product cannot produce.
const ADDRESS = `${namespace}@acme.com`.toLowerCase();

const repository = new PrismaSsoMembershipRepository(prisma);

async function user({ id, email }: { id: string; email: string | null }) {
  await prisma.user.create({ data: { id, name: id, email } });
}

async function memberOf({ userId }: { userId: string }) {
  await prisma.organizationUser.create({
    data: { userId, organizationId: ORGANIZATION, role: "ADMIN" },
  });
}

async function identifierFor({
  userId,
  value,
  state = "VERIFIED",
}: {
  userId: string;
  value: string;
  state?: string;
}) {
  await prisma.identifier.create({
    data: {
      id: `${namespace}-${nanoid(6)}`,
      userId,
      provider: "email",
      value,
      domain: "acme.com",
      state,
      verifiedAt: state === "ATTACHED" ? null : new Date(1_690_000_000_000),
      attachedAt: new Date(1_690_000_000_000),
    },
  });
}

async function organization() {
  await prisma.organization.create({
    data: { id: ORGANIZATION, name: ORGANIZATION, slug: ORGANIZATION },
  });
}

afterEach(async () => {
  await prisma.identifier.deleteMany({
    where: { userId: { contains: namespace } },
  });
  await prisma.organizationUser.deleteMany({
    where: { organizationId: ORGANIZATION },
  });
  await prisma.user.deleteMany({ where: { id: { contains: namespace } } });
  await prisma.organization.deleteMany({ where: { id: ORGANIZATION } });
});

describe("given a connection registered by an administrator who is still a member", () => {
  describe("when the address lives only on their identifier", () => {
    it("recognises them", async () => {
      // The case the broken filter was reaching for, and the one that threw.
      await organization();
      await user({ id: REGISTRANT, email: null });
      await memberOf({ userId: REGISTRANT });
      await identifierFor({ userId: REGISTRANT, value: ADDRESS });

      expect(
        await repository.findRegistrantAtAddress({
          organizationId: ORGANIZATION,
          userId: REGISTRANT,
          email: ADDRESS,
        }),
      ).toBe(true);
    });
  });

  describe("when the address lives only on the legacy user column", () => {
    it("recognises them too", async () => {
      // An account the backfill has not finalized, where `User.email` is
      // still the truth (ADR-101 §5).
      await organization();
      await user({ id: REGISTRANT, email: ADDRESS });
      await memberOf({ userId: REGISTRANT });

      expect(
        await repository.findRegistrantAtAddress({
          organizationId: ORGANIZATION,
          userId: REGISTRANT,
          email: ADDRESS.toUpperCase(),
        }),
      ).toBe(true);
    });
  });

  describe("when the address was proved once and has since been detached", () => {
    it("does not recognise them", async () => {
      // A tombstone still carries `verifiedAt`, so a filter written on that
      // alone keeps a connection dialable by an address its owner gave up.
      await organization();
      await user({ id: REGISTRANT, email: null });
      await memberOf({ userId: REGISTRANT });
      await identifierFor({
        userId: REGISTRANT,
        value: ADDRESS,
        state: "DETACHED",
      });

      expect(
        await repository.findRegistrantAtAddress({
          organizationId: ORGANIZATION,
          userId: REGISTRANT,
          email: ADDRESS,
        }),
      ).toBe(false);
    });
  });
});

describe("given the address belongs to somebody else in the organization", () => {
  describe("when it is offered as the registrant's", () => {
    it("refuses", async () => {
      // The half that keeps a colleague's address out of a connection under
      // setup: the address must resolve to THIS user, not merely to a member.
      await organization();
      await user({ id: REGISTRANT, email: null });
      await user({ id: COLLEAGUE, email: null });
      await memberOf({ userId: REGISTRANT });
      await memberOf({ userId: COLLEAGUE });
      await identifierFor({ userId: COLLEAGUE, value: ADDRESS });

      expect(
        await repository.findRegistrantAtAddress({
          organizationId: ORGANIZATION,
          userId: REGISTRANT,
          email: ADDRESS,
        }),
      ).toBe(false);
    });
  });
});

describe("given the registrant has left the organization", () => {
  describe("when they present the address they registered with", () => {
    it("refuses", async () => {
      // A registrant whose membership was revoked stops being able to dial
      // the connection they left behind.
      await organization();
      await user({ id: REGISTRANT, email: null });
      await identifierFor({ userId: REGISTRANT, value: ADDRESS });

      expect(
        await repository.findRegistrantAtAddress({
          organizationId: ORGANIZATION,
          userId: REGISTRANT,
          email: ADDRESS,
        }),
      ).toBe(false);
    });
  });
});
