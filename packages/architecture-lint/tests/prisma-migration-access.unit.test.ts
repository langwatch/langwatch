import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { lintPrismaMigrationAccess } from "../src/prisma-migration-access.ts";

const roots: string[] = [];
const featureRoot = "packages/enterprise/features/audit-log";
const repository = "repositories/prisma/prisma.history-migration.repository.ts";
const source = `import { scopedPrismaClient, type ScopedPrismaClient } from "@langwatch/prisma-client/ownership";
export class Repository {
  #database: ScopedPrismaClient<["AuditLog", "Agent"]>;
  constructor(database) { this.#database = scopedPrismaClient(database, ["AuditLog", "Agent"]); }
  static create(database) { return new Repository(database); }
}`;
const migration = `import type { SystemMigration } from "@langwatch/system-migrations";
import { Repository } from "../${repository}";
class Repair implements SystemMigration { static create(repository) { return new Repair(repository); } }
export function createRepair(database) { return Repair.create(Repository.create(database)); }`;

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "migration-access-"));
  roots.push(root);
  function write(file: string, content: string) {
    const path = join(root, featureRoot, "server", file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  write(
    "package.json",
    JSON.stringify({
      name: "@langwatch/enterprise-audit-log-server",
      exports: { ".": "./src/index.ts" },
      imports: { "#migration-repository": `./src/${repository}` },
    }),
  );
  write(`src/${repository}`, source);
  write("src/migrations/history.migration.ts", migration);
  write("src/index.ts", 'export { createRepair } from "./migrations/history.migration.ts";');
  return {
    write,
    lint: () =>
      lintPrismaMigrationAccess(
        root,
        [
          {
            id: "audit-log",
            root: featureRoot,
            classification: "enterprise",
            subjects: ["audit-log"],
          },
        ],
        new Set(["AuditLog", "Agent"]),
      ),
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("scoped migration Prisma access", () => {
  it("allows the private literal capability constructed into an actual SystemMigration", () => {
    expect(fixture().lint()).toEqual([]);
  });

  it.each([
    [
      "app consumer",
      "src/app/audit-log.app.ts",
      `import { Repository } from "../${repository}"; export const leaked = Repository.create(database);`,
    ],
    ["barrel export", "src/index.ts", `export { Repository } from "./${repository}";`],
    [
      "type-only barrel export",
      "src/index.ts",
      `export type { Repository } from "./${repository}";`,
    ],
    [
      "alias consumer",
      "src/app/audit-log.app.ts",
      'import { Repository } from "#migration-repository"; export const leaked = Repository.create(database);',
    ],
    [
      "dynamic consumer",
      "src/app/audit-log.app.ts",
      `export const leaked = import("../${repository}");`,
    ],
  ])("rejects a %s", (_label, file, content) => {
    const world = fixture();
    world.write(file, content);
    expect(world.lint()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: expect.stringContaining("must be private") }),
      ]),
    );
  });

  it("rejects a direct package subpath exposing the migration repository", () => {
    const world = fixture();
    world.write(
      "package.json",
      JSON.stringify({
        name: "@langwatch/enterprise-audit-log-server",
        exports: { "./repository": `./src/${repository}` },
      }),
    );
    expect(world.lint().some((issue) => issue.message.includes("must be private"))).toBe(true);
  });

  it("rejects a process importing the private repository directly", () => {
    const world = fixture();
    world.write(
      "../../../../../apps/api/src/app.ts",
      `import { Repository } from "../../../${featureRoot}/server/src/${repository}";`,
    );
    expect(world.lint().some((issue) => issue.message.includes("must be private"))).toBe(true);
  });

  it("rejects a local marker interface masquerading as the framework contract", () => {
    const world = fixture();
    world.write(
      "src/migrations/history.migration.ts",
      migration.replace(
        'import type { SystemMigration } from "@langwatch/system-migrations";',
        "interface SystemMigration {}",
      ),
    );
    expect(world.lint().some((issue) => issue.message.includes("must be private"))).toBe(true);
  });

  it("rejects a decoy migration class beside a factory exporting the repository", () => {
    const world = fixture();
    world.write(
      "src/migrations/history.migration.ts",
      migration.replace(
        "Repair.create(Repository.create(database))",
        "Repository.create(database)",
      ),
    );
    expect(world.lint().some((issue) => issue.message.includes("must be private"))).toBe(true);
  });

  it("rejects a migration's static factory forwarding the repository rather than constructing the migration", () => {
    const world = fixture();
    world.write(
      "src/migrations/history.migration.ts",
      migration.replace("return new Repair(repository)", "return repository"),
    );
    expect(world.lint().some((issue) => issue.message.includes("must be private"))).toBe(true);
  });

  it.each([
    ['["AuditLog", "Agent"]);', "models);"],
    ['["AuditLog", "Agent"]);', '["AuditLog", ...others]);'],
    ['["AuditLog", "Agent"]);', '["AuditLog", "AuditLog"]);'],
    ['["AuditLog", "Agent"]);', '["AuditLog", "Secret"]);'],
    ['ScopedPrismaClient<["AuditLog", "Agent"]>', 'ScopedPrismaClient<["AuditLog"]>'],
  ])("rejects computed or mismatched model access: %s", (from, to) => {
    const world = fixture();
    world.write(`src/${repository}`, source.replace(from, to));
    expect(world.lint().some((issue) => issue.message.includes("literal Prisma models"))).toBe(
      true,
    );
  });

  it("rejects a factory alias escaping the direct call", () => {
    const world = fixture();
    world.write(`src/${repository}`, source + "\nexport const leaked = scopedPrismaClient;");
    expect(world.lint().some((issue) => issue.message.includes("Do not alias"))).toBe(true);
  });

  it("rejects computed namespace access", () => {
    const world = fixture();
    world.write(
      `src/${repository}`,
      'import * as prisma from "@langwatch/prisma-client/ownership"; export const leaked = prisma["scopedPrismaClient"];',
    );
    expect(world.lint().some((issue) => issue.message.includes("Do not alias"))).toBe(true);
  });
});
