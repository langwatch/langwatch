/**
 * @vitest-environment node
 *
 * The one-config-per-scope rule applied to rows written before it
 * existed - against real Postgres, replaying the shipped migration.
 *
 * The write path now claims each scope on save, so no new duplicate can
 * appear. Rows already in a customer's database still carry the old
 * shape: several configs attached to the same scope, of which only the
 * newest ever resolved. Migration
 * 20260814120000_collapse_duplicate_model_default_scopes collapses them
 * by the resolver's own tiebreak, so resolution results do not change.
 *
 * The statements are read from the migration file and replayed inside a
 * rolled-back transaction, narrowed to this test's synthetic rows: the
 * shipped statements are deliberately blanket (a one-shot backfill over
 * every pre-migration row), and the narrowing is a property of the
 * replay only, so the replay cannot disturb rows another suite owns.
 *
 * Spec: specs/model-providers/model-default-config-cascade.feature
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { cleanupTestRows } from "../../../test-utils/cleanupTestRows";
import { prisma } from "../../db";

const MIGRATION_FILE = join(
  process.cwd(),
  "prisma/migrations/20260814120000_collapse_duplicate_model_default_scopes/migration.sql",
);

/** The replay seeds, collapses and asserts inside one transaction,
 *  which is more than Prisma's 5 second default is worth betting a
 *  loaded CI shard on. */
const TX_BUDGET = { timeout: 20_000, maxWait: 10_000 } as const;

/**
 * The two collapse statements exactly as shipped, read from the
 * migration file so this test fails if the rule is ever edited out from
 * under the promise it makes.
 */
function collapseStatements(): { shadowed: string; orphaned: string } {
  const sql = readFileSync(MIGRATION_FILE, "utf8");
  // Whole statements, not lines: a reformatted multi-line DELETE must
  // arrive intact rather than truncated to its first line.
  const statements = sql
    .split(";")
    .map((statement) => statement.replace(/^\s*--.*$/gm, "").trim())
    .filter((statement) => statement.startsWith("DELETE FROM"));
  const shadowed = statements.find((s) =>
    s.startsWith('DELETE FROM "ModelDefaultConfigScope"'),
  );
  const orphaned = statements.find((s) =>
    s.startsWith('DELETE FROM "ModelDefaultConfig" c'),
  );
  if (!shadowed || !orphaned) {
    throw new Error(
      `expected the migration to carry a shadowed-attachment delete and an orphaned-config delete, found ${statements.length} DELETE statement(s)`,
    );
  }
  return { shadowed, orphaned };
}

describe("given configs written before the one-config-per-scope rule (real DB)", () => {
  const ns = `mdcfg-collapse-${nanoid(8)}`;

  let organizationId: string;
  let teamId: string;
  let projectId: string;

  /** A fixed anchor so the seeded createdAt ordering is explicit. */
  const anchor = new Date("2026-08-01T00:00:00.000Z");
  const atMinutes = (minutes: number) =>
    new Date(anchor.getTime() + minutes * 60_000);

  beforeAll(async () => {
    const organization = await prisma.organization.create({
      data: { name: `Collapse Org ${ns}`, slug: `--test-${ns}` },
    });
    organizationId = organization.id;

    const team = await prisma.team.create({
      data: { name: `Team ${ns}`, slug: `--team-${ns}`, organizationId },
    });
    teamId = team.id;

    const project = await prisma.project.create({
      data: {
        name: `Project ${ns}`,
        slug: `--proj-${ns}`,
        teamId,
        language: "typescript",
        framework: "other",
        apiKey: `test-key-${ns}`,
      },
    });
    projectId = project.id;
  });

  afterAll(async () => {
    await cleanupTestRows(prisma, [
      ["modelDefaultConfig", { organizationId }],
      ["project", { id: projectId }],
      ["team", { id: teamId }],
      ["organization", { id: organizationId }],
    ]);
  });

  describe("when the shipped collapse statements run", () => {
    /** @scenario Migration collapses pre-invariant duplicate configs per scope */
    it("keeps the config the resolver already picked and drops the rest", async () => {
      const { shadowed, orphaned } = collapseStatements();
      const rollback = new Error("rollback");

      await expect(
        prisma.$transaction(async (tx) => {
          // Two configs on the same org scope. Only `newest` ever
          // resolved: the resolver tiebreaks same-scope configs by
          // createdAt DESC.
          const oldest = await tx.modelDefaultConfig.create({
            data: {
              organizationId,
              config: { DEFAULT: "openai/gpt-5.4-mini" },
              createdAt: atMinutes(0),
              scopes: {
                create: [
                  { scopeType: "ORGANIZATION", scopeId: organizationId },
                ],
              },
            },
          });
          const newest = await tx.modelDefaultConfig.create({
            data: {
              organizationId,
              config: { DEFAULT: "gemini/gemini-2.5-pro" },
              createdAt: atMinutes(10),
              scopes: {
                create: [
                  { scopeType: "ORGANIZATION", scopeId: organizationId },
                ],
              },
            },
          });
          // Also shadowed on the org scope, but it holds a project scope
          // nobody else claims, so collapsing must keep the row alive.
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
          // Same createdAt on the team scope: the migration falls back
          // to the higher id, so the winner is decided rather than left
          // to insertion order. The ids are explicit and differ only in
          // one lowercase letter, so "higher" means the same thing in
          // this assertion as it does under the statement's COLLATE "C".
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

          // The shadowed single-scope config had nothing left to hold.
          expect(
            await tx.modelDefaultConfig.findUnique({
              where: { id: oldest.id },
            }),
          ).toBeNull();

          // The shadowed multi-scope config kept the scope it alone held.
          const survivor = await tx.modelDefaultConfig.findUnique({
            where: { id: multiScope.id },
            select: { scopes: { select: { scopeType: true, scopeId: true } } },
          });
          expect(survivor?.scopes).toEqual([
            { scopeType: "PROJECT", scopeId: projectId },
          ]);

          const teamHolders = await tx.modelDefaultConfigScope.findMany({
            where: { scopeType: "TEAM", scopeId: teamId },
            select: { configId: true },
          });
          expect(teamHolders).toEqual([{ configId: tiedWinnerId }]);
          expect(
            await tx.modelDefaultConfig.findUnique({
              where: { id: tiedLoserId },
            }),
          ).toBeNull();

          throw rollback;
        }, TX_BUDGET),
      ).rejects.toThrow("rollback");

      // The rollback held: none of the synthetic rows survived.
      const survivors = await prisma.modelDefaultConfig.findMany({
        where: { organizationId },
        select: { id: true },
      });
      expect(survivors).toEqual([]);
    });
  });
});
