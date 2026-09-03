/**
 * @vitest-environment node
 *
 * Keys that predate the explicit routing choice keep falling back -
 * against real Postgres, replaying the shipped migration.
 *
 * The old implicit default was "a null routing policy means fall back
 * across every eligible provider". routingMode made that choice
 * explicit, with NONE as the safer default for NEW keys only; the
 * migration pinned every existing row to the behaviour it already had.
 *
 * Only the backfill-replay half of the original suite is ported here. The
 * other two scenarios drove the bundle `GatewayConfigMaterialiser`
 * produces (`new GatewayConfigMaterialiser(prisma).materialise(vk)`), and
 * that class now takes a `GatewayService` and a model-provider credentials
 * port in its constructor — a DI reshape too large to adapt mechanically.
 * See the batch report for those two scenario titles.
 *
 * Spec: specs/ai-gateway/fallback.feature,
 *       specs/ai-gateway/virtual-key-creation.feature
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Prisma } from "@langwatch/prisma-client/generated";

import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

class AllowTestQueries extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(context.args);
  }
}

const databaseUrl = process.env.DATABASE_URL;
const connection = databaseUrl
  ? PrismaConnectionService.create({ guard: new AllowTestQueries() }).connect(
      PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }),
    )
  : null;
const prisma = connection?.client as PrismaClient;

const suffix = nanoid(8);

const ORG_ID = `org-rmm-${suffix}`;
const TEAM_ID = `team-rmm-${suffix}`;
const PROJECT_ID = `proj-rmm-${suffix}`;
const USER_ID = `usr-rmm-${suffix}`;
const POLICY_ID = `policy-rmm-${suffix}`;
const MP_OPENAI_ID = `mp-rmm-openai-${suffix}`;

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../../..");
const MIGRATION_FILE = join(
  repositoryRoot,
  "packages/prisma-client/prisma/migrations/20260728120001_budgets_provider_filter_group_scope_routing_mode/migration.sql",
);

/**
 * The backfill statements exactly as shipped. Read from the migration
 * file so this test fails if the mapping is ever edited out from under
 * the promise it makes.
 */
function backfillStatements(): string[] {
  const sql = readFileSync(MIGRATION_FILE, "utf8");
  // Whole statements, not lines: a reformatted multi-line UPDATE must
  // arrive intact rather than truncated to its first line.
  const statements = sql
    .split(";")
    .map((statement) => statement.replace(/^\s*--.*$/gm, "").trim())
    .filter((statement) => statement.startsWith('UPDATE "VirtualKey"'));
  if (statements.length !== 2) {
    throw new Error(
      `expected the migration to carry exactly two VirtualKey backfill statements, found ${statements.length}`,
    );
  }
  // The shipped statements are deliberately blanket: the one-shot
  // backfill addresses every pre-migration row. The tenant-scoped
  // narrowing below is a property of the replay only.
  if (!statements[0]!.endsWith('WHERE "routingPolicyId" IS NULL')) {
    throw new Error("first backfill statement changed shape");
  }
  if (!statements[1]!.endsWith('WHERE "routingPolicyId" IS NOT NULL')) {
    throw new Error("second backfill statement changed shape");
  }
  return statements;
}

async function createBareKeyRow(args: {
  id: string;
  routingPolicyId?: string | null;
  tx?: Prisma.TransactionClient;
}): Promise<void> {
  const client = args.tx ?? prisma;
  await client.virtualKey.create({
    data: {
      id: args.id,
      organizationId: ORG_ID,
      name: args.id,
      hashedSecret: `hash-${args.id}`,
      displayPrefix: "vk-lw-test",
      config: {},
      createdById: USER_ID,
      routingPolicyId: args.routingPolicyId ?? null,
      // The state a pre-migration row is in right after the column lands
      // with its NONE default, before the backfill runs.
      routingMode: "NONE",
      scopes: {
        create: [{ scopeType: "PROJECT", scopeId: PROJECT_ID }],
      },
    },
  });
}

describe.skipIf(!databaseUrl)(
  "keys that predate the routing choice keep falling back against real PG",
  () => {
    beforeAll(async () => {
      await prisma.organization.create({
        data: { id: ORG_ID, name: `RMM ${suffix}`, slug: `rmm-${suffix}` },
      });
      await prisma.team.create({
        data: {
          id: TEAM_ID,
          name: `RMM Team ${suffix}`,
          slug: `rmm-team-${suffix}`,
          organizationId: ORG_ID,
        },
      });
      await prisma.project.create({
        data: {
          id: PROJECT_ID,
          name: `RMM Project ${suffix}`,
          slug: `rmm-proj-${suffix}`,
          teamId: TEAM_ID,
          language: "en",
          framework: "openai",
          apiKey: `rmm-key-${suffix}`,
        },
      });
      await prisma.user.create({
        data: {
          id: USER_ID,
          email: `rmm-${suffix}@example.com`,
          name: "RMM Tester",
        },
      });
      await prisma.routingPolicy.create({
        data: {
          id: POLICY_ID,
          organizationId: ORG_ID,
          name: `RMM Policy ${suffix}`,
          modelProviderIds: [MP_OPENAI_ID],
        },
      });
      await prisma.modelProvider.create({
        data: {
          id: MP_OPENAI_ID,
          organizationId: ORG_ID,
          name: "RMM OpenAI",
          provider: "openai",
          enabled: true,
          scopes: {
            create: [{ scopeType: "ORGANIZATION", scopeId: ORG_ID }],
          },
        },
      });
    }, 120_000);

    afterAll(async () => {
      await prisma.auditLog.deleteMany({ where: { organizationId: ORG_ID } });
      await prisma.gatewayChangeEvent.deleteMany({
        where: { organizationId: ORG_ID },
      });
      await prisma.gatewayBudget.deleteMany({
        where: { organizationId: ORG_ID },
      });
      await prisma.virtualKey.deleteMany({ where: { organizationId: ORG_ID } });
      await prisma.modelProvider.deleteMany({
        where: { organizationId: ORG_ID },
      });
      await prisma.routingPolicy.deleteMany({
        where: { organizationId: ORG_ID },
      });
      await prisma.project.deleteMany({ where: { id: PROJECT_ID } });
      await prisma.team.deleteMany({ where: { id: TEAM_ID } });
      await prisma.user.deleteMany({ where: { id: USER_ID } });
      await prisma.organization.deleteMany({ where: { id: ORG_ID } });
    }, 120_000);

    /** @scenario Keys that predate the choice keep falling back */
    it("the shipped backfill maps a legacy null-policy key to FALLBACK_ALL and a policy key to POLICY", async () => {
      const legacyNullPolicyId = `vk-rmm-legacy-${suffix}`;
      const legacyPolicyId = `vk-rmm-policy-${suffix}`;
      const statements = backfillStatements();

      // Replay the migration's own statements against rows shaped exactly
      // like pre-migration keys, then roll everything back: the backfill
      // is a one-shot whose blanket WHERE would rewrite post-migration
      // NONE keys if it ever ran again, so it must never touch the shared
      // database outside this transaction.
      const rollback = new Error("rollback");
      await expect(
        prisma.$transaction(async (tx) => {
          await createBareKeyRow({ id: legacyNullPolicyId, tx });
          await createBareKeyRow({
            id: legacyPolicyId,
            routingPolicyId: POLICY_ID,
            tx,
          });

          for (const statement of statements) {
            // Same statements, narrowed to this test's synthetic rows: the
            // blanket WHERE would take a row lock on every matching
            // VirtualKey in the shared test database until the rollback,
            // blocking any concurrently running suite.
            await tx.$executeRawUnsafe(
              `-- @tenancy: replaying the shipped backfill, narrowed to this test's synthetic rows\n${statement} AND "id" IN ('${legacyNullPolicyId}', '${legacyPolicyId}')`,
            );
          }

          const nullPolicyRow = await tx.virtualKey.findUniqueOrThrow({
            where: { id: legacyNullPolicyId },
            select: { routingMode: true },
          });
          expect(nullPolicyRow.routingMode).toBe("FALLBACK_ALL");

          const policyRow = await tx.virtualKey.findUniqueOrThrow({
            where: { id: legacyPolicyId },
            select: { routingMode: true },
          });
          expect(policyRow.routingMode).toBe("POLICY");

          throw rollback;
        }),
      ).rejects.toThrow("rollback");

      // The rollback held: neither synthetic legacy row survived.
      const survivors = await prisma.virtualKey.findMany({
        where: { id: { in: [legacyNullPolicyId, legacyPolicyId] } },
        select: { id: true },
      });
      expect(survivors).toEqual([]);
    });
  },
);
