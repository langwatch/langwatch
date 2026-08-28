/**
 * @vitest-environment node
 *
 * The migration that clears the execution settings off folder rows, run
 * against real data.
 *
 * The migration is the half of "a test suite holds no execution settings"
 * that fixes what is already stored; `assertFolderUpdate` in suite.service.ts
 * is the half that keeps new writes correct. This file runs the migration's
 * own SQL, read from the migration directory, so the rule under test is the
 * one that shipped and not a copy of it.
 *
 * The SQL touches every project of the database, so each case runs inside an
 * interactive transaction that is rolled back. The projects and suites are
 * seeded before it and cleaned up after; only the migration's writes are
 * discarded.
 *
 * @see specs/suites/folder-run-plan-reuse.feature
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Prisma } from "~/generated/prisma/client";
import { getTestUser } from "../../../utils/testUtils";
import { prisma } from "../../db";

const MIGRATIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../prisma/migrations",
);

/**
 * The migration is found by its name, not by its number.
 *
 * A migration keeps its number only until `main` merges a higher one, and then
 * it is renumbered so it still runs. A path holding the number breaks on that
 * day, in a test that has nothing to do with the change that caused it.
 */
function migrationPath(): string {
  const matches = readdirSync(MIGRATIONS_DIR).filter((name) =>
    name.endsWith("_folder_rows_hold_no_execution_settings"),
  );
  if (matches.length !== 1) {
    throw new Error(
      `Expected one folder execution settings migration, found ${matches.length}: ${matches.join(", ")}`,
    );
  }
  return join(MIGRATIONS_DIR, matches[0]!, "migration.sql");
}

/**
 * A migration runs before the Prisma client and its multitenancy middleware
 * exist, and it works on every project at once. The guard on raw queries has
 * to be told that, and this is the comment it reads.
 */
const TENANCY_OPTOUT =
  "-- @tenancy: a data migration, which runs over every project by design\n";

/** The migration's statements, comments stripped and the opt-out added. */
function migrationStatements(): string[] {
  const sql = readFileSync(migrationPath(), "utf8")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
  return sql
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0)
    .map((statement) => `${TENANCY_OPTOUT}${statement}`);
}

const statements = migrationStatements();
const suffix = nanoid(8);
/** One project per case, so a case never reads another's rows. */
const projectIds = {
  folders: `test-folder-settings-${suffix}`,
  plans: `test-folder-settings-plan-${suffix}`,
};

let teamId: string;

async function createProject(projectId: string) {
  await prisma.project.upsert({
    where: { id: projectId },
    update: {},
    create: {
      id: projectId,
      name: projectId,
      slug: projectId,
      apiKey: `sk-lw-${projectId}`,
      teamId,
      language: "en",
      framework: "test",
    },
  });
}

async function createSuite(params: {
  projectId: string;
  name: string;
  kind: "folder" | "custom";
}) {
  return prisma.simulationSuite.create({
    data: {
      id: `suite_${nanoid()}`,
      projectId: params.projectId,
      name: params.name,
      slug: `${params.name.toLowerCase()}-${nanoid(6)}`,
      kind: params.kind,
      scenarioIds: [],
      targets: [{ type: "http", referenceId: "agent_prod" }],
      repeatCount: 3,
      simulatorModel: "openai/gpt-5-mini",
      judgeModel: "openai/gpt-5-mini",
      labels: [],
    },
  });
}

/** A sentinel thrown to roll the migration's writes back. */
class Rollback extends Error {
  constructor(readonly value: unknown) {
    super("rollback");
  }
}

/**
 * Runs the migration, hands the caller a transaction client to read what it
 * wrote, then rolls every one of its writes back.
 */
async function withMigrationApplied<T>(
  read: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  try {
    await prisma.$transaction(
      async (tx) => {
        for (const statement of statements) {
          await tx.$executeRawUnsafe(statement);
        }
        throw new Rollback(await read(tx));
      },
      { timeout: 60_000, maxWait: 20_000 },
    );
  } catch (error) {
    if (error instanceof Rollback) return error.value as T;
    throw error;
  }
  throw new Error("the migration transaction was not rolled back");
}

beforeAll(async () => {
  await getTestUser();
  const organization = await prisma.organization.findUnique({
    where: { slug: "test-organization" },
  });
  const team = await prisma.team.findFirst({
    where: { slug: "test-team", organizationId: organization!.id },
  });
  teamId = team!.id;
  for (const projectId of Object.values(projectIds)) {
    await createProject(projectId);
  }
});

afterAll(async () => {
  for (const projectId of Object.values(projectIds)) {
    await prisma.simulationSuite.deleteMany({ where: { projectId } });
    await prisma.project.deleteMany({ where: { id: projectId } });
  }
});

describe("given a folder row carrying execution settings", () => {
  /** @scenario "The stored execution settings are cleared off every test suite row" */
  it("clears its targets, repeat count and models", async () => {
    const projectId = projectIds.folders;
    const folder = await createSuite({
      projectId,
      name: "Refunds",
      kind: "folder",
    });

    const migrated = await withMigrationApplied((tx) =>
      tx.simulationSuite.findFirst({ where: { id: folder.id, projectId } }),
    );

    expect(migrated?.targets).toEqual([]);
    expect(migrated?.repeatCount).toBe(1);
    expect(migrated?.simulatorModel).toBeNull();
    expect(migrated?.judgeModel).toBeNull();
  });

  it("leaves the row itself in place, name and members included", async () => {
    const projectId = projectIds.folders;
    const folder = await createSuite({
      projectId,
      name: "Checkout",
      kind: "folder",
    });

    const migrated = await withMigrationApplied((tx) =>
      tx.simulationSuite.findFirst({ where: { id: folder.id, projectId } }),
    );

    expect(migrated?.name).toBe("Checkout");
    expect(migrated?.kind).toBe("folder");
    expect(migrated?.slug).toBe(folder.slug);
  });
});

describe("given a custom run plan carrying the same settings", () => {
  // A custom row IS a run plan, and its stored configuration is what a run of
  // it executes, so the migration must not touch it.
  it("leaves its stored configuration alone", async () => {
    const projectId = projectIds.plans;
    const plan = await createSuite({
      projectId,
      name: "Nightly",
      kind: "custom",
    });

    const migrated = await withMigrationApplied((tx) =>
      tx.simulationSuite.findFirst({ where: { id: plan.id, projectId } }),
    );

    expect(migrated?.targets).toEqual([
      { type: "http", referenceId: "agent_prod" },
    ]);
    expect(migrated?.repeatCount).toBe(3);
    expect(migrated?.simulatorModel).toBe("openai/gpt-5-mini");
    expect(migrated?.judgeModel).toBe("openai/gpt-5-mini");
  });
});
