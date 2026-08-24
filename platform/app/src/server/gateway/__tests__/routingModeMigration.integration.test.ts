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
 * These tests prove two halves of that promise:
 *
 *   1. The backfill statements shipped in the migration file map a
 *      legacy null-policy row to FALLBACK_ALL and a policy-carrying row
 *      to POLICY. Replayed verbatim inside a rolled-back transaction,
 *      so re-running them cannot disturb other rows.
 *   2. A key in the migrated state materialises a bundle that walks
 *      every provider it can reach: full chain, more than one attempt,
 *      routing_mode "fallback_all".
 *
 * Spec: specs/ai-gateway/fallback.feature,
 *       specs/ai-gateway/virtual-key-creation.feature
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Prisma } from "~/generated/prisma/client";

import { prisma } from "~/server/db";
import {
  startTestContainers,
  stopTestContainers,
} from "~/server/event-sourcing/__tests__/integration/testContainers";
import { GatewayConfigMaterialiser } from "../config.materialiser";
import { VirtualKeyService } from "../virtualKey.service";

const suffix = nanoid(8);

const ORG_ID = `org-rmm-${suffix}`;
const TEAM_ID = `team-rmm-${suffix}`;
const PROJECT_ID = `proj-rmm-${suffix}`;
const USER_ID = `usr-rmm-${suffix}`;
const POLICY_ID = `policy-rmm-${suffix}`;
const MP_OPENAI_ID = `mp-rmm-openai-${suffix}`;
const MP_ANTHROPIC_ID = `mp-rmm-anthropic-${suffix}`;

const MIGRATION_FILE = join(
  process.cwd(),
  "../../packages/prisma-client/prisma/migrations/20260728120001_budgets_provider_filter_group_scope_routing_mode/migration.sql",
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

describe("keys that predate the routing choice keep falling back against real PG", () => {
  beforeAll(async () => {
    await startTestContainers();

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
    await prisma.modelProvider.create({
      data: {
        id: MP_ANTHROPIC_ID,
        organizationId: ORG_ID,
        name: "RMM Anthropic",
        provider: "anthropic",
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
    await stopTestContainers();
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

  /** @scenario Keys that existed before the routing choice keep failing over */
  it("a key in the migrated state materialises the full fallback chain", async () => {
    const service = VirtualKeyService.create(prisma);
    const { virtualKey } = await service.create({
      organizationId: ORG_ID,
      name: `rmm-migrated-${suffix}`,
      actorUserId: USER_ID,
      scopes: [{ scopeType: "PROJECT", scopeId: PROJECT_ID }],
      // The state the migration leaves every pre-existing key in.
      routingMode: "FALLBACK_ALL",
    });

    const bundle = await new GatewayConfigMaterialiser(prisma).materialise(
      virtualKey,
    );

    expect(bundle.routing_mode).toBe("fallback_all");
    expect(bundle.fallback.chain).toEqual(
      expect.arrayContaining([MP_OPENAI_ID, MP_ANTHROPIC_ID]),
    );
    expect(bundle.fallback.chain).toHaveLength(2);
    expect(bundle.fallback.max_attempts).toBeGreaterThan(1);
  });

  it("a new key created without a routing choice does not fall back", async () => {
    const service = VirtualKeyService.create(prisma);
    const { virtualKey } = await service.create({
      organizationId: ORG_ID,
      name: `rmm-new-${suffix}`,
      actorUserId: USER_ID,
      scopes: [{ scopeType: "PROJECT", scopeId: PROJECT_ID }],
    });

    expect(virtualKey.routingMode).toBe("NONE");

    const bundle = await new GatewayConfigMaterialiser(prisma).materialise(
      virtualKey,
    );
    expect(bundle.routing_mode).toBe("none");
    expect(bundle.fallback.max_attempts).toBe(1);
  });
});
