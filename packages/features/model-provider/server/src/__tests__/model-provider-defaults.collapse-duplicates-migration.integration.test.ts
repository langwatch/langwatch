/**
 * ("Migration collapses pre-invariant duplicate configs per scope")
 * @vitest-environment node
 * @see specs/model-providers/model-default-config-cascade.feature
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import {
  DB_URL,
  cleanupTenancyFixture,
  createTenancyFixture,
  createTestPrismaClient,
  testNamespace,
  type TenancyFixture,
} from "./support/model-provider-integration.support";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../..");
const MIGRATION_FILE = join(
  repositoryRoot,
  "packages/prisma-client/prisma/migrations/20260814120000_collapse_duplicate_model_default_scopes/migration.sql",
);

/** The replay seeds, collapses and asserts inside one transaction. */
const TX_BUDGET = { timeout: 20_000, maxWait: 10_000 } as const;

/**
 * The two collapse statements exactly as shipped, read from the migration
 * file so this test fails if the rule is ever edited out from under the
 * promise it makes.
 */
function collapseStatements(): { shadowed: string; orphaned: string } {
  const sql = readFileSync(MIGRATION_FILE, "utf8");
  const statements = sql
    .split(";")
    .map((statement) => statement.replace(/^\s*--.*$/gm, "").trim())
    .filter((statement) => statement.startsWith("DELETE FROM"));
  const shadowed = statements.find((s) => s.startsWith('DELETE FROM "ModelDefaultConfigScope"'));
  const orphaned = statements.find((s) => s.startsWith('DELETE FROM "ModelDefaultConfig" c'));
  if (!shadowed || !orphaned) {
    throw new Error(
      `expected the migration to carry a shadowed-attachment delete and an orphaned-config delete, found ${statements.length} DELETE statement(s)`,
    );
  }
  return { shadowed, orphaned };
}

describe.skipIf(!DB_URL)(
  "given configs written before the one-config-per-scope rule (real Postgres)",
  () => {
    const prisma: PrismaClient = createTestPrismaClient();
    const ns = testNamespace("mdcfg-collapse");
    const anchor = new Date("2026-08-01T00:00:00.000Z");
    const atMinutes = (minutes: number) => new Date(anchor.getTime() + minutes * 60_000);

    let fixture: TenancyFixture;

    beforeAll(async () => {
      fixture = await createTenancyFixture(prisma, ns);
    });

    afterAll(async () => {
      await cleanupTenancyFixture(prisma, fixture);
      await prisma.$disconnect();
    });

    describe("when the shipped collapse statements run", () => {
      /** @scenario Migration collapses pre-invariant duplicate configs per scope */
      it("keeps the config the resolver already picked and drops the rest", async () => {
        const { shadowed, orphaned } = collapseStatements();
        const rollback = new Error("rollback");
        const { organizationId, teamId, projectId } = fixture;

        await expect(
          prisma.$transaction(async (tx) => {
            const oldest = await tx.modelDefaultConfig.create({
              data: {
                organizationId,
                config: { DEFAULT: "openai/gpt-5.4-mini" },
                createdAt: atMinutes(0),
                scopes: { create: [{ scopeType: "ORGANIZATION", scopeId: organizationId }] },
              },
            });
            const newest = await tx.modelDefaultConfig.create({
              data: {
                organizationId,
                config: { DEFAULT: "gemini/gemini-2.5-pro" },
                createdAt: atMinutes(10),
                scopes: { create: [{ scopeType: "ORGANIZATION", scopeId: organizationId }] },
              },
            });
            const multiScope = await tx.modelDefaultConfig.create({
              data: {
                organizationId,
                config: { FAST: "openai/gpt-5.4-mini" },
                createdAt: atMinutes(5),
                scopes: {
                  create: [
                    { scopeType: "ORGANIZATION", scopeId: organizationId },
                    { scopeType: "PROJECT", scopeId: projectId },
                  ],
                },
              },
            });
            const tiedLoserId = `${ns}-tied-a`;
            const tiedWinnerId = `${ns}-tied-b`;
            for (const [id, model] of [
              [tiedLoserId, "openai/gpt-5.5"],
              [tiedWinnerId, "anthropic/claude-sonnet-4-6"],
            ] as const) {
              await tx.modelDefaultConfig.create({
                data: {
                  id,
                  organizationId,
                  config: { DEFAULT: model },
                  createdAt: atMinutes(20),
                  scopes: { create: [{ scopeType: "TEAM", scopeId: teamId }] },
                },
              });
            }

            const narrowing = `AND c."organizationId" = '${organizationId}'`;
            await tx.$executeRawUnsafe(
              `-- @tenancy: replaying the shipped collapse, narrowed to this test's synthetic rows\n${shadowed} ${narrowing}`,
            );
            await tx.$executeRawUnsafe(
              `-- @tenancy: replaying the shipped collapse, narrowed to this test's synthetic rows\n${orphaned} ${narrowing}`,
            );

            const orgHolders = await tx.modelDefaultConfigScope.findMany({
              where: { scopeType: "ORGANIZATION", scopeId: organizationId },
              select: { configId: true },
            });
            expect(orgHolders).toEqual([{ configId: newest.id }]);

            expect(await tx.modelDefaultConfig.findUnique({ where: { id: oldest.id } })).toBeNull();

            const survivor = await tx.modelDefaultConfig.findUnique({
              where: { id: multiScope.id },
              select: { scopes: { select: { scopeType: true, scopeId: true } } },
            });
            expect(survivor?.scopes).toEqual([{ scopeType: "PROJECT", scopeId: projectId }]);

            const teamHolders = await tx.modelDefaultConfigScope.findMany({
              where: { scopeType: "TEAM", scopeId: teamId },
              select: { configId: true },
            });
            expect(teamHolders).toEqual([{ configId: tiedWinnerId }]);
            expect(
              await tx.modelDefaultConfig.findUnique({ where: { id: tiedLoserId } }),
            ).toBeNull();

            throw rollback;
          }, TX_BUDGET),
        ).rejects.toThrow("rollback");

        const survivors = await prisma.modelDefaultConfig.findMany({
          where: { organizationId },
          select: { id: true },
        });
        expect(survivors).toEqual([]);
      });
    });
  },
);
