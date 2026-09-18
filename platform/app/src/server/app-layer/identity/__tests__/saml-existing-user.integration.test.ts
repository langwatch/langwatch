/** @vitest-environment node */
import {
  identifierProviderFor,
  normalizeIdentifierValue,
} from "@langwatch/identity";
import { deriveIdentifierId } from "@langwatch/identity-server";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "~/server/db";

import { PrismaSessionRecords, RedisSessionCache } from "../session-adapters";
import { SessionInventoryService } from "../session-inventory.service";
import { SessionRevocationService } from "../session-revocation.service";
import {
  createSamlFixture,
  createSigningIdentity,
} from "./saml-signin.fixture";

let idp: Awaited<ReturnType<typeof createSigningIdentity>>;
let fixture: Awaited<ReturnType<typeof createSamlFixture>>;

beforeAll(async () => {
  idp = await createSigningIdentity();
});
beforeEach(async () => {
  fixture = await createSamlFixture(idp);
});
afterEach(async () => {
  await fixture.cleanup();
});

describe("an existing local user signing in through signed SAML", () => {
  /** @scenario "An inactive directory user cannot sign in through its connection" */
  it.each([
    "first",
    "linked",
    "deleted",
  ])("refuses inactive tenant access on %s SAML sign-in", async (kind) => {
    const { email, user } = await fixture.createLocalUser();
    if (kind !== "first") {
      expect((await fixture.signIn(email)).session?.user.id).toBe(user.id);
    }
    const sessionsBefore = await prisma.session.count({
      where: { userId: user.id },
    });
    await prisma.scimUserResource.create({
      data: {
        organizationId: fixture.organizationId,
        userId: user.id,
        userName: email,
        active: false,
        deletedAt: kind === "deleted" ? new Date() : null,
      },
    });

    const result = await fixture.signIn(email);

    expect(result.location).toContain("error=");
    expect(result.session).toBeNull();
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(
      sessionsBefore,
    );
    expect(
      await prisma.user.findUniqueOrThrow({ where: { id: user.id } }),
    ).toMatchObject({
      deactivatedAt: null,
      email,
    });
  });

  /** @scenario "Repeated SAML sessions retain their exact sign-in method" */
  it("attributes repeated callbacks for per-method revocation", async () => {
    const { email, user } = await fixture.createLocalUser();
    const first = await fixture.signIn(email);
    expect(first.session?.user.id).toBe(user.id);
    const account = await prisma.account.findFirstOrThrow({
      where: { userId: user.id, provider: fixture.providerId },
    });
    const identifier = await prisma.identifier.create({
      data: {
        id: deriveIdentifierId({
          userId: user.id,
          provider: identifierProviderFor(account.provider),
          providerAccountId: account.providerAccountId,
          normalizedValue: normalizeIdentifierValue(email),
          occurredAtMs: account.createdAt.getTime(),
        }),
        userId: user.id,
        provider: "oidc",
        providerId: fixture.providerId,
        providerAccountId: email,
        accountId: account.id,
        issuer: account.issuer,
        value: email,
        state: "VERIFIED",
        attachedAt: new Date(),
        verifiedAt: new Date(),
      },
    });

    const repeated = await fixture.signIn(email);
    const another = await fixture.signIn(email);

    expect(repeated.session?.user.id).toBe(user.id);
    expect(another.session?.user.id).toBe(user.id);
    for (const callback of [repeated, another]) {
      expect(
        await prisma.session.findUniqueOrThrow({
          where: { id: callback.session?.session.id ?? "missing-session" },
          select: { identifierId: true, amr: true },
        }),
      ).toEqual({ identifierId: identifier.id, amr: [] });
    }
    const records = new PrismaSessionRecords(prisma);
    const inventory = new SessionInventoryService({
      records,
      revocation: new SessionRevocationService({
        records,
        cache: new RedisSessionCache(),
      }),
    });
    expect(
      await inventory.endSessionsForIdentifier({
        userId: user.id,
        identifierId: identifier.id,
      }),
    ).toEqual({ ended: 3 });
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
  });

  /** @scenario "A signed SAML assertion links a verified local account" */
  it.each(["founder", "invitee"])("preserves %s on repeat", async (kind) => {
    const { email, user, account, identifier } =
      await fixture.createLocalUser();
    if (kind === "founder") {
      await prisma.organizationUser.create({
        data: {
          userId: user.id,
          organizationId: fixture.organizationId,
          role: "ADMIN",
        },
      });
      await prisma.ssoConnection.update({
        where: { id: fixture.providerId },
        data: {
          state: "VERIFIED",
          createdBy: user.id,
        },
      });
    }

    const first = await fixture.signIn(email);

    expect(first.location).toBe("http://localhost:3000/dashboard");
    expect(first.session?.user.id).toBe(user.id);
    const binding = await prisma.account.findFirstOrThrow({
      where: { userId: user.id, provider: fixture.providerId },
    });
    const repeated = await fixture.signIn(email);
    expect(repeated.session?.user.id).toBe(user.id);
    expect(
      await prisma.account.findMany({
        where: { userId: user.id },
        select: { id: true },
      }),
    ).toEqual(expect.arrayContaining([{ id: account.id }, { id: binding.id }]));
    expect(await prisma.account.count({ where: { userId: user.id } })).toBe(2);
    expect(
      await prisma.user.findUniqueOrThrow({ where: { id: user.id } }),
    ).toMatchObject({
      email: user.email,
      emailVerified: true,
      name: user.name,
      image: user.image,
    });
    expect(
      await prisma.identifier.findUnique({ where: { id: identifier.id } }),
    ).toEqual(identifier);
    expect(await prisma.user.count({ where: { email: user.email } })).toBe(1);
  });

  /** @scenario "SAML linking refuses unsuitable local identity evidence" */
  it.each([
    "unverified",
    "deactivated",
    "wrong-domain",
    "tampered",
    "duplicate-email",
    "foreign-identifier",
    "foreign-account",
  ])("refuses %s without a new binding or session", async (kind) => {
    const email =
      kind === "wrong-domain"
        ? "member@unproved.test"
        : `member@${fixture.domain}`;
    const { user } = await fixture.createLocalUser(
      kind !== "unverified",
      email,
    );
    if (kind === "deactivated") {
      await prisma.user.update({
        where: { id: user.id },
        data: { deactivatedAt: new Date() },
      });
    }
    if (kind === "duplicate-email") {
      await fixture.createLocalUser(true, email.toUpperCase());
    }
    if (kind === "foreign-identifier" || kind === "foreign-account") {
      const foreign = await fixture.createLocalUser(
        true,
        `foreign@${fixture.domain}`,
      );
      if (kind === "foreign-identifier") {
        await prisma.identifier.update({
          where: { id: foreign.identifier.id },
          data: { value: email },
        });
      } else {
        await prisma.account.create({
          data: {
            userId: foreign.user.id,
            provider: fixture.providerId,
            issuer: "https://idp.saml.test",
            providerAccountId: email,
          },
        });
      }
    }
    const fixtureUsers = {
      OR: [
        { id: user.id },
        {
          email: {
            endsWith: `@${fixture.domain}`,
            mode: "insensitive" as const,
          },
        },
      ],
    };
    const before = await prisma.account.count({
      where: { user: fixtureUsers },
    });

    const result = await fixture.signIn(email, kind === "tampered");

    expect(result.location).toContain("error=");
    expect(result.session).toBeNull();
    expect(await prisma.account.count({ where: { user: fixtureUsers } })).toBe(
      before,
    );
    expect(await prisma.session.count({ where: { user: fixtureUsers } })).toBe(
      0,
    );
    expect(
      await prisma.user.findUniqueOrThrow({ where: { id: user.id } }),
    ).toMatchObject({
      email,
      emailVerified: kind !== "unverified",
      name: user.name,
      image: user.image,
    });
  });
});
