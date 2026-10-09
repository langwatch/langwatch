import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  lintUpgradeSignInTablesAt,
  signInTables,
} from "../src/policies/persistence/upgrade-sign-in-tables.ts";
import type { FeatureCatalogueEntry } from "../src/types.ts";
import { readFeatureCatalogue } from "../src/workspace/feature-catalogue.ts";

const REPOSITORY_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/**
 * @see packages/architecture-enforcer/specs/upgrade-sign-in-tables.feature
 */

const roots: string[] = [];

const SCHEMA = ["User", "Organization", "Session", "SsoConnection", "Role", "Dataset", "ApiKey", "Project", "Monitor"]
  .map((model) => `model ${model} {\n  id String @id\n}\n`)
  .join("");

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "upgrade-sign-in-tables-"));
  roots.push(root);
  const catalogue: FeatureCatalogueEntry[] = [];
  const write = (path: string, source: string) => {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, source);
  };
  write("packages/prisma-client/prisma/schema.prisma", SCHEMA);

  const world = {
    claims(id: string, ...models: string[]) {
      if (!catalogue.some((entry) => entry.id === id)) {
        catalogue.push({ id, root: `modules/${id}`, classification: "core", subjects: [id] });
      }
      const names = models.map((model) => `"${model}"`).join(", ");
      write(
        `modules/${id}/process/src/repositories/prisma/prisma.${id}.repository.ts`,
        `import { prismaTables } from "@langwatch/prisma-client/ownership";
export class Repository { static readonly tables = prismaTables(${names}); }
`,
      );
    },
    step({ owner, mode, sql }: { owner: string; mode: "blocking" | "background"; sql: string }) {
      write(
        `modules/${owner}/process/src/${owner}.module.ts`,
        `export const module = define(({ repositories }) => [
  defineMigrationStep({
    id: "${owner}:fix-rows",
    kind: "data",
    mode: "${mode}",
    run: async () => repositories.migration.fixRows(),
  }),
]);
`,
      );
      write(
        `modules/${owner}/process/src/repositories/prisma/prisma.${owner}-migration.repository.ts`,
        `export class Repository {
  async other() {
    return this.database.$executeRaw\`UPDATE "Dataset" SET "x" = 1\`;
  }

  async fixRows() {
    // reads from nothing
    return this.database.$executeRaw\`
      -- @tenancy: fleet-wide
      ${sql}
    \`;
  }
}
`,
      );
    },
    findings: () =>
      lintUpgradeSignInTablesAt({ root, catalogue }).map((violation) => ({
        file: violation.file.slice(root.length + 1),
        message: violation.message,
        allowed: violation.allowed,
      })),
    tables: () => [...signInTables({ root, catalogue })].toSorted(([a], [b]) => a.localeCompare(b)),
  };

  return { ...world, write };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("upgrade sign-in tables", () => {
  /** @scenario "A blocking step whose SQL touches a sign-in table is refused, naming the step and the table" */
  it("reports the step, the table and its owner, and says to ship a background step", () => {
    const world = fixture();
    world.claims("user", "User");
    world.step({ owner: "user", mode: "blocking", sql: 'UPDATE "User" SET "x" = 1' });

    expect(world.findings()).toEqual([
      {
        file: "modules/user/process/src/repositories/prisma/prisma.user-migration.repository.ts",
        message: 'Blocking step "user:fix-rows" touches the sign-in tables of user (User).',
        allowed: expect.stringContaining("background step"),
      },
    ]);
  });

  /** @scenario "A background step touching a sign-in table passes" */
  it("reports nothing for a background step", () => {
    const world = fixture();
    world.claims("organization", "Organization");
    world.step({
      owner: "organization",
      mode: "background",
      sql: 'UPDATE "Organization" SET "x" = 1',
    });

    expect(world.findings()).toEqual([]);
  });

  /** @scenario "A blocking step touching only other owners' tables passes" */
  it("reports nothing when the step touches a table no sign-in owner claims", () => {
    const world = fixture();
    world.claims("dataset", "Dataset");
    world.step({ owner: "dataset", mode: "blocking", sql: 'UPDATE "Dataset" SET "x" = 1' });

    expect(world.findings()).toEqual([]);
  });

  /** @scenario "A Postgres schema migration on a sign-in table passes" */
  it("does not read Prisma migrations, which the api holds through", () => {
    const world = fixture();
    world.claims("auth", "Session");
    world.write(
      "packages/prisma-client/prisma/migrations/20261001000000_add/migration.sql",
      'ALTER TABLE "Session" ADD COLUMN "x" TEXT;\n',
    );

    expect(world.findings()).toEqual([]);
  });

  /** @scenario "The sign-in owners are read from ownership claims" */
  it("resolves exactly the tables the sign-in and ingest owners claim", () => {
    const world = fixture();
    world.claims("auth", "Session");
    world.claims("user", "User");
    world.claims("organization", "Organization");
    world.claims("authz", "Role");
    world.claims("identity", "SsoConnection");
    world.claims("api-key", "ApiKey");
    world.claims("project", "Project");
    world.claims("monitor", "Monitor");
    world.claims("dataset", "Dataset");

    expect(world.tables()).toEqual([
      ["ApiKey", "api-key"],
      ["Monitor", "monitor"],
      ["Organization", "organization"],
      ["Project", "project"],
      ["Role", "authz"],
      ["Session", "auth"],
      ["SsoConnection", "identity"],
      ["User", "user"],
    ]);
  });

  describe("given the tree", () => {
    /** @scenario "The tree has no blocking step touching a sign-in table" */
    it("finds no blocking step touching a sign-in table", () => {
      const findings = lintUpgradeSignInTablesAt({
        root: REPOSITORY_ROOT,
        catalogue: readFeatureCatalogue(REPOSITORY_ROOT, []),
      });

      expect(findings).toEqual([]);
    }, 120_000);
  });
});
