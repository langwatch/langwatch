/**
 * The adopt gap (Alex, 2026-10-06): an unproven account an earlier pass finalized is reopened by
 * the blocking sweep, and once adopted keeps no pre-proof credential in identity's tables.
 * Spec: specs/identity/identifier-model.feature.
 */
import {
  type AttachIdentifierCommandData,
  arrivalStateForProvider,
  type DetachIdentifierCommandData,
  normalizeIdentifierValue,
  type VerifyIdentifierCommandData,
} from "@langwatch/identity-contract";
import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { cleanupTestRows } from "@langwatch/test-harness/prisma";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME } from "../rules/identity-migration-names.rules.ts";
import { CryptoIdentifierIdentityService } from "../services/crypto-identifier-identity.service.ts";
import { IdentityBackfillPlanService } from "../services/identity-backfill-plan.service.ts";
import { IdentityBackfillService } from "../services/identity-backfill.service.ts";
import { IdentitySecretCarryService } from "../services/identity-secret-carry.service.ts";
import { liveRepositories } from "./support/live-repositories.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;
const PRE_PROOF_PASSWORD = "pre-proof-password-hash";
const identifierIdentity = CryptoIdentifierIdentityService.create();

describe.skipIf(!DB_URL)("an unproven account an earlier pass finalized", () => {
  const namespace = `unproven-${nanoid(8)}`;
  const ids = { sam: "", kim: "", lee: "" };
  const connection = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
    logger: createLogger("langwatch:identity:test:unproven-account"),
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
  const prisma = connection.client as PrismaClient;
  const repositories = liveRepositories(prisma);
  const backfill = IdentityBackfillService.create({
    reads: repositories.backfill,
    users: repositories.users,
    identity: projectionWrites(prisma),
    secrets: IdentitySecretCarryService.create(repositories.secretCarry),
    plan: IdentityBackfillPlanService.create(identifierIdentity),
  });
  const samEmail = `sam-${namespace}@example.com`;
  const samAccountId = `${namespace}-sam-password`;

  async function stateOf(userId: string) {
    return prisma.systemMigrationTenantState.findUnique({
      where: {
        migrationName_tenantId: {
          migrationName: IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME,
          tenantId: userId,
        },
      },
      select: { status: true, updatedAt: true },
    });
  }

  async function seedState(userId: string, status: string) {
    await prisma.systemMigrationTenantState.create({
      data: {
        migrationName: IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME,
        tenantId: userId,
        status,
      },
    });
  }

  beforeAll(async () => {
    const signedInOnce = new Date("2026-01-01T00:00:00Z");
    const sam = await prisma.user.create({
      data: { name: "sam", email: samEmail, emailVerified: false, lastLoginAt: signedInOnce },
    });
    ids.sam = sam.id;
    await prisma.account.create({
      data: {
        id: samAccountId,
        userId: sam.id,
        type: "credential",
        provider: "credential",
        providerAccountId: sam.id,
        password: PRE_PROOF_PASSWORD,
      },
    });
    // A release before the unproven rule asked nothing of sign-in; a stamped sign-in lets
    // today's pass finalize and carry exactly as that release did, then the stamp goes.
    const earlier = await backfill.migrateUser({ userId: sam.id });
    if (earlier.status !== "finalized") throw new Error(`setup: sam was ${earlier.status}`);
    await repositories.latch.recordFinalized({ userId: sam.id, report: earlier.report });
    await prisma.user.update({ where: { id: sam.id }, data: { lastLoginAt: null } });

    const kim = await prisma.user.create({
      data: { name: "kim", email: `kim-${namespace}@example.com`, emailVerified: true },
    });
    ids.kim = kim.id;
    await seedState(kim.id, "finalized");
    const lee = await prisma.user.create({
      data: { name: "lee", email: `lee-${namespace}@example.com`, emailVerified: false },
    });
    ids.lee = lee.id;
    await seedState(lee.id, "rolled_back");
  });

  afterAll(async () => {
    const userIds = Object.values(ids).filter((id) => id !== "");
    await cleanupTestRows(prisma, [
      ["accountCredential", { userId: { in: userIds } }],
      ["identifier", { userId: { in: userIds } }],
      ["account", { userId: { in: userIds } }],
      ...userIds.map(
        (tenantId) =>
          [
            "systemMigrationTenantState",
            { migrationName: IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME, tenantId },
          ] as const,
      ),
      ["user", { id: { in: userIds } }],
    ]);
    await prisma.$disconnect();
  });

  /** @scenario "A blocking sweep reopens every unproven account an earlier pass finalized" */
  it("reopens only the unproven account, once, and a dry run changes nothing", async () => {
    expect((await stateOf(ids.sam))?.status).toBe("finalized");
    expect(await prisma.accountCredential.count({ where: { userId: ids.sam } })).toBe(1);

    const wouldReopen = await repositories.migration.reopenUnprovenAccounts({ dryRun: true });
    expect(wouldReopen).toBeGreaterThanOrEqual(1);
    expect((await stateOf(ids.sam))?.status).toBe("finalized");

    await repositories.migration.reopenUnprovenAccounts({ dryRun: false });
    const reopened = await stateOf(ids.sam);
    expect(reopened?.status).toBe("migrated");
    expect((await stateOf(ids.kim))?.status).toBe("finalized");
    expect((await stateOf(ids.lee))?.status).toBe("rolled_back");

    expect(await repositories.migration.reopenUnprovenAccounts({ dryRun: false })).toBe(0);
    expect((await stateOf(ids.sam))?.updatedAt).toEqual(reopened?.updatedAt);
  });

  /** @scenario "An adopted account keeps no pre-proof credential in identity's tables" */
  it("holds no pre-proof credential in identity's tables once adopted and passed again", async () => {
    expect((await stateOf(ids.sam))?.status).toBe("migrated");
    expect((await backfill.migrateUser({ userId: ids.sam })).status).toBe("migrated");

    // The confirmation link's adoption, as user's repository writes it
    // (modules/user/process/src/repositories/prisma/prisma.user.repository.ts, adoptUnconfirmed).
    await prisma.$transaction([
      prisma.account.deleteMany({ where: { userId: ids.sam } }),
      prisma.passkey.deleteMany({ where: { userId: ids.sam } }),
      prisma.user.update({
        where: { id: ids.sam },
        data: {
          emailVerified: true,
          signupConfirmationPending: false,
          passkeySignupClaimHash: null,
        },
      }),
    ]);
    const outcome = await backfill.migrateUser({ userId: ids.sam });

    expect(await prisma.accountCredential.findMany({ where: { userId: ids.sam } })).toEqual([]);
    const live = await prisma.identifier.findMany({
      where: { userId: ids.sam, accountId: { not: null }, state: { not: "DETACHED" } },
    });
    expect(live).toEqual([]);
    const [signIn] = await repositories.signInAccounts.findLegacySignInAccounts({
      normalizedValue: samEmail,
    });
    expect(signIn?.methods.hasPassword).toBe(false);
    expect(outcome.status).toBe("finalized");
  });
});

/**
 * The fold's `Identifier` rows written straight, as the projection would land them: the pass's
 * own command pipeline is proven elsewhere, and only the rows it leaves matter here.
 */
function projectionWrites(prisma: PrismaClient) {
  return {
    async attachIdentifier(data: AttachIdentifierCommandData) {
      const value = normalizeIdentifierValue(data.value);
      const id = identifierIdentity.deriveIdentifierId({
        userId: data.userId,
        provider: data.provider,
        providerAccountId: data.providerAccountId,
        normalizedValue: value,
        occurredAtMs: data.occurredAtMs,
      });
      await prisma.identifier.upsert({
        where: { id },
        update: {},
        create: {
          id,
          userId: data.userId,
          provider: data.provider,
          value,
          accountId: data.accountId,
          providerId: data.providerId,
          issuer: data.issuer,
          providerAccountId: data.providerAccountId,
          state: arrivalStateForProvider(data.provider),
          attachedAt: new Date(data.occurredAtMs),
        },
      });
      return [];
    },
    async verifyIdentifier(data: VerifyIdentifierCommandData) {
      await prisma.identifier.updateMany({
        where: { id: data.identifierId, state: "ATTACHED" },
        data: { state: "VERIFIED", verifiedAt: new Date(data.occurredAtMs) },
      });
      return [];
    },
    async detachIdentifier(data: DetachIdentifierCommandData) {
      await prisma.identifier.updateMany({
        where: { id: data.identifierId },
        data: { state: "DETACHED", detachedAt: new Date(data.occurredAtMs) },
      });
      return [];
    },
  };
}
