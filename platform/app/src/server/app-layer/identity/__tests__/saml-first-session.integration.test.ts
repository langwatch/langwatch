/** @vitest-environment node */
import {
  identifierProviderFor,
  normalizeIdentifierValue,
} from "@langwatch/identity";
import { deriveIdentifierId } from "@langwatch/identity-server";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "~/server/db";
import { BetterAuthOperatorSessions } from "../identity-lookup-adapters";
import { identityStorageTransactions } from "../identity-storage-transaction.adapter";
import {
  PrismaSessionIdentifiers,
  PrismaSessionRecords,
  RedisSessionCache,
} from "../session-adapters";
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

describe("revoking a method after its first SAML session", () => {
  /** @scenario "The first SAML session stays revocable before projection catches up" */
  it("ends the first session after the identity projection catches up", async () => {
    const { email, user } = await fixture.createLocalUser();
    const first = await fixture.signIn(email);
    expect(first.session?.user.id).toBe(user.id);
    const account = await prisma.account.findFirstOrThrow({
      where: { userId: user.id, provider: fixture.providerId },
    });
    const identifierId = deriveIdentifierId({
      userId: user.id,
      provider: identifierProviderFor(account.provider),
      providerAccountId: account.providerAccountId,
      normalizedValue: normalizeIdentifierValue(email),
      occurredAtMs: account.createdAt.getTime(),
    });
    await prisma.identifier.create({
      data: {
        id: identifierId,
        userId: user.id,
        provider: identifierProviderFor(account.provider),
        providerId: fixture.providerId,
        providerAccountId: email,
        accountId: account.id,
        issuer: account.issuer,
        value: email,
        state: "VERIFIED",
        attachedAt: account.createdAt,
        verifiedAt: account.createdAt,
      },
    });
    const repeated = await fixture.signIn(email);
    expect(
      await prisma.session.findMany({
        where: { userId: user.id },
        select: { amr: true },
      }),
    ).toEqual([{ amr: [] }, { amr: [] }]);
    const historical = await prisma.session.create({
      data: {
        userId: user.id,
        sessionToken: `historical-${user.id}`,
        expires: new Date(Date.now() + 86_400_000),
      },
      select: { id: true },
    });
    const operator = new BetterAuthOperatorSessions(
      new SessionRevocationService({
        records: new PrismaSessionRecords(prisma),
        cache: new RedisSessionCache(),
      }),
    );

    await operator.endForIdentifier({ userId: user.id, identifierId });

    expect((await repeated.readSession()) === null).toBe(true);
    expect((await first.readSession()) === null).toBe(true);
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(1);
    expect(
      await prisma.session.findUnique({
        where: { id: historical.id },
        select: { identifierId: true },
      }),
    ).toEqual({ identifierId: null });
  });

  /** @scenario "Unprojected session attribution refuses uncertain account evidence" */
  it.each([
    "outside-transaction",
    "missing-account",
    "missing-subject",
    "missing-user-email",
    "wrong-user",
    "wrong-provider",
    "wrong-subject",
    "detached",
    "tombstone-without-timestamp",
    "foreign-projection",
    "conflicting-projection",
  ])("refuses %s evidence", async (kind) => {
    const { email, user } = await fixture.createLocalUser();
    const foreign = await fixture.createLocalUser(
      true,
      `foreign@${fixture.domain}`,
    );
    const account = await prisma.account.create({
      data: {
        userId: kind === "wrong-user" ? foreign.user.id : user.id,
        provider:
          kind === "wrong-provider" ? "other-provider" : fixture.providerId,
        issuer: "https://idp.saml.test",
        providerAccountId: kind === "wrong-subject" ? "other-subject" : email,
      },
    });
    if (kind === "missing-account") {
      await prisma.account.delete({ where: { id: account.id } });
    }
    if (kind === "missing-user-email") {
      await prisma.user.update({
        where: { id: user.id },
        data: { email: null },
      });
    }
    if (
      [
        "detached",
        "tombstone-without-timestamp",
        "foreign-projection",
        "conflicting-projection",
      ].includes(kind)
    ) {
      const identifierId = deriveIdentifierId({
        userId: user.id,
        provider: identifierProviderFor(account.provider),
        providerAccountId: account.providerAccountId,
        normalizedValue: normalizeIdentifierValue(email),
        occurredAtMs: account.createdAt.getTime(),
      });
      await prisma.identifier.create({
        data: {
          id: identifierId,
          userId: kind === "foreign-projection" ? foreign.user.id : user.id,
          provider: "oidc",
          providerId:
            kind === "conflicting-projection"
              ? "other-provider"
              : fixture.providerId,
          providerAccountId: email,
          accountId: account.id,
          value: email,
          state:
            kind.startsWith("detached") || kind.startsWith("tombstone")
              ? "DETACHED"
              : "VERIFIED",
          attachedAt: account.createdAt,
          detachedAt: kind === "detached" ? new Date() : null,
        },
      });
    }
    const identifiers = new PrismaSessionIdentifiers(
      prisma,
      identityStorageTransactions,
    );
    const lookup = () =>
      identifiers.findIdentifierIdFor({
        userId: user.id,
        providerId: fixture.providerId,
        ...(kind === "missing-subject" ? {} : { providerAccountId: email }),
      });
    const result =
      kind === "outside-transaction"
        ? await lookup()
        : await prisma.$transaction((transaction) =>
            identityStorageTransactions.run(transaction, lookup),
          );

    expect(result).toBeNull();
  });
});
