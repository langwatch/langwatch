import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { lintPrismaTableOwnership } from "../src/policies/persistence/prisma-table-ownership.ts";
import type { FeatureCatalogueEntry } from "../src/types.ts";
import { snapshotOf } from "./workspace.ts";

const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "table-ownership-"));
  roots.push(root);
  const catalogue: FeatureCatalogueEntry[] = [];
  function write(path: string, source: string) {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, source);
  }
  write(
    "packages/prisma-client/prisma/schema.prisma",
    `model User {
  id String @id
  @@map("users")
}
model Profile {
  id String @id
  @@map("users")
}
model AuditLog {
  id String @id
}
`,
  );
  function repository(
    feature: string,
    expression: string,
    options: { imports?: string; path?: string; declaration?: string } = {},
  ) {
    const featureRoot = `modules/${feature}`;
    if (!catalogue.some((entry) => entry.id === feature)) {
      catalogue.push({
        id: feature,
        root: featureRoot,
        classification: "core",
        subjects: [feature],
      });
    }
    write(
      `${featureRoot}/server/src/${options.path ?? `repositories/prisma/prisma.${feature}.repository.ts`}`,
      `${options.imports ?? 'import { prismaTables } from "@langwatch/prisma-client/ownership";'}
${options.declaration ?? `export class Repository { static readonly tables = ${expression}; }`}`,
    );
  }
  return { repository, lint: () => lintPrismaTableOwnership(snapshotOf({ root, catalogue })) };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Prisma table ownership lint", () => {
  it("finds conflicting physical tables across separately installed features", () => {
    const world = fixture();
    world.repository("user", 'prismaTables("User")');
    world.repository("audit-log", 'prismaTables("Profile")');
    expect(world.lint()).toEqual([
      expect.objectContaining({
        policy: "prisma-table-ownership",
        message: expect.stringContaining("Table users is claimed by audit-log and user"),
      }),
    ]);
  });

  it("allows a coherent group and multiple private repositories under one owner", () => {
    const world = fixture();
    world.repository("user", 'prismaTables("User", "Profile")');
    world.repository("user", 'prismaTables("User")', {
      path: "repositories/prisma/prisma.profile.repository.ts",
    });
    expect(world.lint()).toEqual([]);
  });

  it("infers a native repository claim from its direct base declaration", () => {
    const world = fixture();
    world.repository("user", "unused", {
      imports: 'import { PrismaRepository } from "@langwatch/prisma-client";',
      declaration: 'export class Repository extends PrismaRepository.for("User") {}',
    });

    expect(world.lint()).toEqual([]);
  });

  it("infers a transactional native repository claim from its direct base declaration", () => {
    const world = fixture();
    world.repository("user", "unused", {
      imports: 'import { PrismaRepository } from "@langwatch/prisma-client";',
      declaration:
        'export class Repository extends PrismaRepository.transactionalFor("Profile") {}',
    });

    expect(world.lint()).toEqual([]);
  });

  it("rejects a native repository claim outside the Prisma repository seam", () => {
    const world = fixture();
    world.repository("user", "unused", {
      imports: 'import { PrismaRepository } from "@langwatch/prisma-client";',
      path: "services/user.service.ts",
      declaration: 'export class Repository extends PrismaRepository.for("User") {}',
    });

    expect(world.lint()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: expect.stringContaining("directly extend") }),
        expect.objectContaining({ message: expect.stringContaining("repository declaration") }),
      ]),
    );
  });

  it("rejects an unclaimed native repository base", () => {
    const world = fixture();
    world.repository("user", "unused", {
      imports: 'import { PrismaRepository } from "@langwatch/prisma-client";',
      declaration: "export class Repository extends PrismaRepository {}",
    });

    expect(world.lint()).toEqual([
      expect.objectContaining({ message: expect.stringContaining("declare owned models") }),
    ]);
  });

  it.each([
    [
      'claim("Missing")',
      'import { prismaTables as claim } from "@langwatch/prisma-client/ownership";',
    ],
    [
      'ownership.prismaTables("Missing")',
      'import * as ownership from "@langwatch/prisma-client/ownership";',
    ],
  ])("follows imported binding provenance for %s", (expression, imports) => {
    const world = fixture();
    world.repository("user", expression, { imports });
    expect(world.lint()).toEqual([
      expect.objectContaining({ message: "Unknown Prisma model Missing." }),
    ]);
  });

  it.each(["prismaTables()", "prismaTables(...models)", "prismaTables(model)"])(
    "rejects hidden claim %s",
    (expression) => {
      const world = fixture();
      world.repository("user", expression);
      expect(world.lint()).toEqual([
        expect.objectContaining({ message: expect.stringContaining("literal model name") }),
      ]);
    },
  );

  it("rejects claims placed on an app", () => {
    const world = fixture();
    world.repository("user", 'prismaTables("User")', { path: "app/user.app.ts" });
    expect(world.lint()).toEqual([
      expect.objectContaining({ message: expect.stringContaining("repository declaration") }),
    ]);
  });

  it("rejects forwarding the claim factory", () => {
    const world = fixture();
    world.repository("user", 'claim("User")', {
      imports:
        'import { prismaTables } from "@langwatch/prisma-client/ownership"; const claim = prismaTables;',
    });
    expect(world.lint()).toEqual([
      expect.objectContaining({ message: expect.stringContaining("Do not alias or forward") }),
    ]);
  });

  it("does not mistake an unrelated function for the ownership factory", () => {
    const world = fixture();
    world.repository("user", 'prismaTables("Missing")', {
      imports: 'import { prismaTables } from "./unrelated.ts";',
    });
    expect(world.lint()).toEqual([]);
  });

  it("rejects re-exports that would conceal a second owner's claim", () => {
    const world = fixture();
    world.repository("user", 'prismaTables("User")');
    world.repository("audit-log", 'claim("User")', {
      imports: 'import { claim } from "./claims.ts";',
    });
    world.repository("audit-log", "null", {
      path: "repositories/prisma/claims.ts",
      imports: 'export { prismaTables as claim } from "@langwatch/prisma-client/ownership";',
    });
    expect(world.lint()).toEqual([
      expect.objectContaining({ message: expect.stringContaining("Do not re-export") }),
    ]);
  });

  it.each(['ownership["prismaTables"]("User")', 'alias("User")'])(
    "rejects concealed namespace use %s",
    (expression) => {
      const world = fixture();
      world.repository("user", expression, {
        imports:
          'import * as ownership from "@langwatch/prisma-client/ownership";' +
          (expression.startsWith("alias") ? "const { prismaTables: alias } = ownership;" : ""),
      });
      expect(world.lint()).toEqual([
        expect.objectContaining({ message: expect.stringContaining("Prisma ownership namespace") }),
      ]);
    },
  );
});
