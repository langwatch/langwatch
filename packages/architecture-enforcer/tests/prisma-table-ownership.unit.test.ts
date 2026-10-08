import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  lintPrismaTableOwnership,
  SHARED_PRISMA_TABLES,
  type SharedPrismaTable,
} from "../src/policies/persistence/prisma-table-ownership.ts";
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
model Project {
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
      `${featureRoot}/process/src/${options.path ?? `repositories/prisma/prisma.${feature}.repository.ts`}`,
      `${options.imports ?? 'import { prismaTables } from "@langwatch/prisma-client/ownership";'}
${options.declaration ?? `export class Repository { static readonly tables = ${expression}; }`}`,
    );
  }
  return {
    repository,
    write,
    lint: (shared: readonly SharedPrismaTable[] = []) =>
      lintPrismaTableOwnership(snapshotOf({ root, catalogue }), shared),
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Prisma table ownership lint", () => {
  /** @scenario "Mapped table names identify the same storage" */
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

  /** @scenario "Multiple repositories implement one coherent owner" */
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

  /** @scenario "Invalid claims fail locally" */
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

  /** @scenario "An App cannot own a second copy of the table list" */
  it("rejects claims placed on an app", () => {
    const world = fixture();
    world.repository("user", 'prismaTables("User")', { path: "app/user.app.ts" });
    expect(world.lint()).toEqual([
      expect.objectContaining({ message: expect.stringContaining("repository declaration") }),
    ]);
  });

  /** @scenario "Invalid claims fail locally" */
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

  describe("given project shares Project for reading with entitlement", () => {
    const SHARED: SharedPrismaTable[] = [
      { table: "Project", owner: "project", readers: ["entitlement"], reason: "x" },
    ];
    const NATIVE = 'import { PrismaRepository } from "@langwatch/prisma-client";';
    const READER = "modules/entitlement/process/src/repositories/prisma/prisma.usage.repository.ts";
    const WRITER = READER.replace("usage", "entitlement");

    function world(reads: string) {
      const built = fixture();
      built.repository("project", "unused", {
        imports: NATIVE,
        declaration: 'export class Repository extends PrismaRepository.for("Project") {}',
      });
      built.repository("entitlement", "unused", {
        imports: NATIVE,
        declaration: `export class Repository extends PrismaRepository.for("Project") {
  list(db: any) { ${reads} }
}`,
      });
      return built;
    }
    const messages = (built: ReturnType<typeof fixture>, shared = SHARED) =>
      built.lint(shared).map((violation) => violation.message);

    /** @scenario "A module reading a Prisma table its owner shares with it passes" */
    it("reports nothing for the named reader's claim, delegate read and SQL read", () => {
      const built = world('return db.project.findMany({ where: { id: "p" } });');
      built.write(
        READER.replace("usage", "usage-sql"),
        'export const query = `SELECT id FROM "Project" WHERE id = $1`;',
      );

      expect(messages(built)).toEqual([]);
    });

    /** @scenario "A module the owner did not name still may not claim a shared Prisma table" */
    it("reports a claim by a module the declaration does not name", () => {
      const built = world("return db.project.findMany({});");
      built.repository("experiment", 'prismaTables("Project")');

      expect(messages(built)).toEqual([
        expect.stringContaining("Table Project is claimed by experiment and project"),
      ]);
    });

    /** @scenario "A named reader writing a shared Prisma table is reported" */
    it("reports the named reader's delegate and SQL writes", () => {
      const built = world(
        'db.project.findMany({}); return db.project.update({ where: { id: "p" } });',
      );
      built.write(
        READER.replace("usage", "usage-sql"),
        'export const query = `UPDATE "Project" SET name = $1`;',
      );

      expect(messages(built)).toEqual([
        "entitlement writes Project, which project shares with it for reading only.",
        "entitlement writes Project, which project shares with it for reading only.",
      ]);
    });

    /** @scenario "A shared Prisma table declared by a module that does not own it is reported" */
    it("reports a declaration naming the wrong owner", () => {
      const built = world("return db.project.findMany({});");
      const wrong = [{ ...SHARED[0]!, owner: "organization" }];

      expect(messages(built, wrong)).toEqual([
        "Table Project is declared shared by organization, which does not own it. Fix or delete the declaration.",
      ]);
    });

    /** @scenario "A named reader's write a share admits by file passes" */
    it("reports nothing for a write in the file the share's write exception names", () => {
      const built = world(
        'db.project.findMany({}); return db.project.update({ where: { id: "p" } });',
      );
      const admitted = [
        { ...SHARED[0]!, writes: [{ reader: "entitlement", file: WRITER, reason: "x" }] },
      ];

      expect(messages(built, admitted)).toEqual([]);
    });

    /** @scenario "A named reader's write a share admits by file passes" */
    it("still reports the reader's write in a file the exception does not name", () => {
      const built = world(
        'db.project.findMany({}); return db.project.update({ where: { id: "p" } });',
      );
      built.write(
        READER.replace("usage", "usage-sql"),
        'export const query = `DELETE FROM "Project" WHERE id = $1`;',
      );
      const admitted = [
        { ...SHARED[0]!, writes: [{ reader: "entitlement", file: WRITER, reason: "x" }] },
      ];

      expect(messages(built, admitted)).toEqual([
        "entitlement writes Project, which project shares with it for reading only.",
      ]);
    });

    /** @scenario "A share's write exception that matches no write is reported" */
    it("reports a write exception whose file no longer writes the table", () => {
      const built = world("return db.project.findMany({});");
      const admitted = [
        { ...SHARED[0]!, writes: [{ reader: "entitlement", file: WRITER, reason: "x" }] },
      ];

      expect(messages(built, admitted)).toEqual([
        `The write exception for entitlement writing Project in ${WRITER} matches no write. Delete it.`,
      ]);
    });

    /** @scenario "A share's write exception that matches no write is reported" */
    it("reports a write exception naming a module the share does not name as a reader", () => {
      const built = world("return db.project.findMany({});");
      const admitted = [
        { ...SHARED[0]!, writes: [{ reader: "experiment", file: WRITER, reason: "x" }] },
      ];

      expect(messages(built, admitted)).toEqual([
        `The write exception for experiment writing Project in ${WRITER} matches no write. Delete it.`,
      ]);
    });

    /** @scenario "A shared Prisma reader that no longer reads the table is reported" */
    it("reports a named reader the tree no longer has", () => {
      const built = world('return "Project";');

      expect(messages(built)).toEqual([
        "Table Project is shared with entitlement, which no longer reads it. Delete the reader.",
      ]);
    });
  });

  /** @scenario "Every shared Prisma table carries a reason" */
  it("gives each declared Prisma share and write exception a reason and a known shape", () => {
    const writes = SHARED_PRISMA_TABLES.flatMap((item) => item.writes ?? []);

    expect(SHARED_PRISMA_TABLES.filter((item) => item.reason.trim() === "")).toEqual([]);
    expect(writes.filter((item) => item.reason.trim() === "")).toEqual([]);
    expect(SHARED_PRISMA_TABLES.map((item) => [item.table, item.owner, item.readers])).toEqual([
      [
        "Project",
        "project",
        [
          "entitlement",
          "billing",
          "data-retention",
          "data-privacy",
          "instant-eval-judge",
          "nurturing",
        ],
      ],
      [
        "Team",
        "organization",
        ["data-retention", "data-privacy", "instant-eval-judge", "nurturing"],
      ],
      ["OrganizationUser", "organization", ["authz", "data-privacy"]],
      ["Organization", "organization", ["scim", "entitlement", "billing"]],
      ["Topic", "topic", ["trace"]],
      ["Annotation", "annotation", ["trace"]],
      ["AnnotationScore", "annotation", ["trace"]],
    ]);
    expect(writes.map((item) => [item.reader, item.file.split("/").at(-1)])).toEqual([
      ["authz", "prisma.authz-admission.repository.ts"],
      ["authz", "prisma.authz-ledger-read.repository.ts"],
      ["billing", "prisma.billing-account-facts.repository.ts"],
    ]);
  });
});
