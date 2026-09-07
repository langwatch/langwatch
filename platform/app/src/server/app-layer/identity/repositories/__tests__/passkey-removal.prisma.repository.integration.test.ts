/** @vitest-environment node */
import { nanoid } from "nanoid";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "~/server/db";
import { LastWayInService } from "../../last-way-in.service";
import { PrismaLastWayInRepository } from "../last-way-in.prisma.repository";
import { PrismaPasskeyRemovalRepository } from "../passkey-removal.prisma.repository";

const namespace = `passkey-removal-${nanoid(8)}`;

function twoPartyBarrier(): () => Promise<void> {
  let arrivals = 0;
  let release: (() => void) | null = null;
  const bothArrived = new Promise<void>((resolve) => {
    release = resolve;
  });
  return async () => {
    arrivals += 1;
    if (arrivals === 2) {
      if (release === null) {
        throw new Error("barrier was not initialized");
      }
      release();
    }
    await bothArrived;
  };
}

async function seedUser({
  suffix,
  passkeyCount = 1,
  legacyPassword,
  identityPassword,
}: {
  suffix: string;
  passkeyCount?: number;
  legacyPassword?: string | null;
  identityPassword?: string | null;
}): Promise<{ userId: string; passkeyIds: string[] }> {
  const userId = `${namespace}-${suffix}`;
  await prisma.user.create({
    data: {
      id: userId,
      email: `${userId}@example.com`,
      name: suffix,
      emailVerified: true,
    },
  });
  if (legacyPassword !== undefined) {
    await prisma.account.create({
      data: {
        id: `${userId}-legacy-account`,
        userId,
        provider: "credential",
        issuer: "local:credential",
        providerAccountId: userId,
        password: legacyPassword,
      },
    });
  }
  if (identityPassword !== undefined) {
    await prisma.accountCredential.create({
      data: {
        id: `${userId}-identity-account`,
        userId,
        provider: "credential",
        password: identityPassword,
      },
    });
  }
  const passkeyIds = Array.from(
    { length: passkeyCount },
    (_, index) => `${userId}-passkey-${index + 1}`,
  );
  await prisma.passkey.createMany({
    data: passkeyIds.map((id) => ({
      id,
      userId,
      publicKey: `public-${id}`,
      credentialID: `credential-${id}`,
      deviceType: "singleDevice",
      backedUp: false,
    })),
  });
  return { userId, passkeyIds };
}

afterAll(async () => {
  await prisma.passkey.deleteMany({
    where: { userId: { startsWith: namespace } },
  });
  await prisma.accountCredential.deleteMany({
    where: { userId: { startsWith: namespace } },
  });
  await prisma.account.deleteMany({
    where: { userId: { startsWith: namespace } },
  });
  await prisma.user.deleteMany({ where: { id: { startsWith: namespace } } });
});

describe("PrismaPasskeyRemovalRepository", () => {
  it("re-evaluates one serialization loser and preserves one of two concurrent passkeys", async () => {
    const { userId, passkeyIds } = await seedUser({
      suffix: "concurrent",
      passkeyCount: 2,
    });
    const waitForBothSnapshots = twoPartyBarrier();
    const repository = PrismaPasskeyRemovalRepository.create({
      prisma,
      routesToIdentity: async () => {
        // The target read has already fixed each SERIALIZABLE snapshot.
        // Both transactions must observe the original two-passkey state.
        await waitForBothSnapshots();
        return false;
      },
    });
    const firstId = passkeyIds[0];
    const secondId = passkeyIds[1];
    if (firstId === undefined || secondId === undefined) {
      throw new Error("the concurrency fixture did not create two passkeys");
    }

    const outcomes = await Promise.all([
      repository.deleteIfAnotherWayInRemains({ passkeyId: firstId }),
      repository.deleteIfAnotherWayInRemains({ passkeyId: secondId }),
    ]);

    expect(outcomes.sort()).toEqual(["deleted", "would_strand_user"]);
    expect(await prisma.passkey.count({ where: { userId } })).toBe(1);
  });

  it.each([
    {
      label: "uses a legacy password while the gate is closed",
      gate: false,
      legacyPassword: "legacy-hash",
      identityPassword: null,
      expected: "deleted",
    },
    {
      label: "uses an identity credential while the gate is open",
      gate: true,
      legacyPassword: null,
      identityPassword: "identity-hash",
      expected: "deleted",
    },
    {
      label: "ignores a stale legacy password while the identity gate is open",
      gate: true,
      legacyPassword: "stale-legacy-hash",
      identityPassword: null,
      expected: "would_strand_user",
    },
    {
      label: "ignores an identity credential while the gate is closed",
      gate: false,
      legacyPassword: null,
      identityPassword: "not-yet-authoritative",
      expected: "would_strand_user",
    },
  ])("$label", async ({ gate, legacyPassword, identityPassword, expected }) => {
    const suffix = `gate-${gate}-${expected}-${nanoid(5)}`;
    const { passkeyIds } = await seedUser({
      suffix,
      legacyPassword,
      identityPassword,
    });
    const passkeyId = passkeyIds[0];
    if (passkeyId === undefined) {
      throw new Error("fixture created no passkey");
    }
    const repository = PrismaPasskeyRemovalRepository.create({
      prisma,
      routesToIdentity: async () => gate,
    });

    expect(await repository.deleteIfAnotherWayInRemains({ passkeyId })).toBe(expected);
    expect(await prisma.passkey.count({ where: { id: passkeyId } })).toBe(
      expected === "deleted" ? 0 : 1,
    );
  });

  it("keeps an absent passkey deletion idempotent", async () => {
    const repository = PrismaPasskeyRemovalRepository.create({
      prisma,
      routesToIdentity: async () => false,
    });
    await expect(
      repository.deleteIfAnotherWayInRemains({
        passkeyId: `${namespace}-absent`,
      }),
    ).resolves.toBe("not_found");
  });
});

describe("PrismaLastWayInRepository", () => {
  it.each([
    {
      label: "sees the canonical password while the identity gate is open",
      gate: true,
      legacyPassword: void 0,
      identityPassword: "identity-hash",
      strands: false,
    },
    {
      label: "sees the compatibility password while the identity gate is closed",
      gate: false,
      legacyPassword: "legacy-hash",
      identityPassword: void 0,
      strands: false,
    },
    {
      label: "ignores a stale compatibility password after the gate opens",
      gate: true,
      legacyPassword: "stale-legacy-hash",
      identityPassword: null,
      strands: true,
    },
    {
      label: "ignores a canonical password before the gate opens",
      gate: false,
      legacyPassword: null,
      identityPassword: "not-yet-authoritative",
      strands: true,
    },
  ])("$label", async ({ gate, legacyPassword, identityPassword, strands }) => {
    const { userId, passkeyIds } = await seedUser({
      suffix: `preflight-${gate}-${strands}-${nanoid(5)}`,
      legacyPassword,
      identityPassword,
    });
    const passkeyId = passkeyIds[0];
    if (passkeyId === undefined) {
      throw new Error("fixture created no passkey");
    }
    const preflight = new LastWayInService({
      records: new PrismaLastWayInRepository(prisma, async () => gate),
    });

    await expect(preflight.passkeyRemovalStrandsUser({ userId, passkeyId })).resolves.toBe(strands);
  });
});
