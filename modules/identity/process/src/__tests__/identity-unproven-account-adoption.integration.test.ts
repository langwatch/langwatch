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
import { userProfileSchema } from "@langwatch/user-contract";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME } from "../rules/identity-migration-names.rules.ts";
import { CryptoIdentifierIdentityService } from "../services/crypto-identifier-identity.service.ts";
import { IdentityBackfillPlanService } from "../services/identity-backfill-plan.service.ts";
import { IdentityBackfillService } from "../services/identity-backfill.service.ts";
import { IdentitySecretCarryService } from "../services/identity-secret-carry.service.ts";
import { liveRepositories } from "./support/live-repositories.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;
const PROFILE_COLUMNS = {
  id: true,
  name: true,
  email: true,
  emailVerified: true,
  image: true,
  pendingSsoSetup: true,
  createdAt: true,
  updatedAt: true,
  lastLoginAt: true,
  deactivatedAt: true,
} as const;
const PRE_PROOF_PASSWORD = "pre-proof-password-hash";
const identifierIdentity = CryptoIdentifierIdentityService.create();

describe.skipIf(!DB_URL)("an unproven account an earlier pass finalized", () => {
  const namespace = `unproven-${nanoid(8)}`;
  const ids = { sam: "", kim: "", lee: "", ana: "", gil: "", gilTwin: "", eve: "", eveTwin: "" };
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
    // user's updateEmail, as its repository writes it (trimmed, lower-cased).
    userApi: {
      updateEmail: async ({ id, email }) =>
        userProfileSchema.parse(
          await prisma.user.update({
            where: { id },
            data: { email: email.trim().toLowerCase() },
            select: PROFILE_COLUMNS,
          }),
        ),
    },
    auditLog: { record: async () => ({ id: nanoid(), occurredAt: Date.now() }) },
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

    // Unproven, carrying only her address: today's pass finalizes her unverified.
    const ana = await prisma.user.create({
      data: { name: "ana", email: `ana-${namespace}@example.com`, emailVerified: false },
    });
    ids.ana = ana.id;
    const anaPass = await backfill.migrateUser({ userId: ana.id });
    if (anaPass.status !== "finalized") throw new Error(`setup: ana was ${anaPass.status}`);
    await repositories.latch.recordFinalized({ userId: ana.id, report: anaPass.report });
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
    expect((await stateOf(ids.ana))?.status).toBe("finalized");

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

  /** @scenario "An unproven account finalized with only its address is confirmed with nothing to wipe" */
  it("confirms the address-only account and leaves no pre-proof credential behind", async () => {
    expect((await stateOf(ids.ana))?.status).toBe("finalized");

    // The confirmation link's adoption, as user's repository writes it (adoptUnconfirmed).
    await prisma.$transaction([
      prisma.account.deleteMany({ where: { userId: ids.ana } }),
      prisma.passkey.deleteMany({ where: { userId: ids.ana } }),
      prisma.user.update({
        where: { id: ids.ana },
        data: {
          emailVerified: true,
          signupConfirmationPending: false,
          passkeySignupClaimHash: null,
        },
      }),
    ]);

    expect(await prisma.accountCredential.findMany({ where: { userId: ids.ana } })).toEqual([]);
    const live = await prisma.identifier.findMany({
      where: { userId: ids.ana, state: { not: "DETACHED" } },
      select: { provider: true, accountId: true },
    });
    expect(live).toEqual([{ provider: "email", accountId: null }]);
    expect((await stateOf(ids.ana))?.status).toBe("finalized");
  });

  /** @scenario "the other still signs in with its own GitHub link" */
  it("finalizes an account whose case twin the address step plus-tagged, keeping its GitHub link", async () => {
    // Addresses are stored lower-cased; user's address step gave the case twin a plus tag.
    const address = `gil-${namespace}@example.com`.toLowerCase();
    const gil = await prisma.user.create({
      data: {
        name: "gil",
        email: address,
        emailVerified: true,
        lastLoginAt: new Date("2025-01-01"),
      },
    });
    ids.gil = gil.id;
    await prisma.account.create({
      data: {
        id: `${namespace}-gil-github`,
        userId: gil.id,
        provider: "github",
        issuer: "https://github.com",
        providerAccountId: `${namespace}-gh`,
      },
    });
    const twin = await prisma.user.create({
      data: {
        name: "gil twin",
        email: address.replace("@", "+2@"),
        emailVerified: true,
        lastLoginAt: new Date("2026-01-01"),
      },
    });
    ids.gilTwin = twin.id;

    const outcome = await backfill.migrateUser({ userId: gil.id });

    expect(outcome).toMatchObject({ status: "finalized" });
    expect(outcome.report).not.toHaveProperty("sharedAddress");
    expect(await prisma.account.count({ where: { userId: gil.id, provider: "github" } })).toBe(1);
    const kept = await backfill.migrateUser({ userId: twin.id });
    expect(kept).toMatchObject({ status: "finalized" });
    expect(kept.report).not.toHaveProperty("sharedAddress");
  });

  /** @scenario "Two email-only accounts sharing an address each get a plus-tagged duplicate address" */
  it("finalizes both unverified, on their own addresses, once the address step plus-tagged one", async () => {
    // Addresses are stored lower-cased; user's address step gave the case twin a plus tag.
    const address = `eve-${namespace}@example.com`.toLowerCase();
    const eve = await prisma.user.create({
      data: {
        name: "eve",
        email: address,
        emailVerified: false,
        createdAt: new Date("2026-01-01"),
      },
    });
    ids.eve = eve.id;
    const eveTwin = await prisma.user.create({
      data: {
        name: "eve twin",
        email: address.replace("@", "+2@"),
        emailVerified: false,
        createdAt: new Date("2026-02-01"),
      },
    });
    ids.eveTwin = eveTwin.id;

    const first = await backfill.migrateUser({ userId: eveTwin.id });
    const second = await backfill.migrateUser({ userId: eve.id });

    const emails = await prisma.user.findMany({
      where: { id: { in: [eve.id, eveTwin.id] } },
      select: { id: true, email: true, emailVerified: true },
    });
    expect(new Map(emails.map((row) => [row.id, row.email]))).toEqual(
      new Map([
        [eve.id, address],
        [eveTwin.id, address.replace("@", "+2@")],
      ]),
    );
    expect(emails.every((row) => !row.emailVerified)).toBe(true);
    expect(first).toMatchObject({ status: "finalized", report: { kind: "adopted" } });
    expect(first.report).not.toHaveProperty("sharedAddress");
    expect(second).toMatchObject({ status: "finalized", report: { kind: "adopted" } });
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
