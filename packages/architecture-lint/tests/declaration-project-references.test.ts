import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { lintDeclarationProjectReferences, type ClassifiedPackage } from "../src/index.ts";

let root = "";

function packageFixture(
  name: string,
  relative: string,
  dependencies: Record<string, string> = {},
): ClassifiedPackage {
  const directory = join(root, relative);
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, "package.json"),
    JSON.stringify({ name, dependencies, scripts: { typecheck: "tsc --noEmit" } }),
  );
  writeFileSync(
    join(directory, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: { noEmit: true },
      references: [],
    }),
  );
  writeFileSync(
    join(directory, "tsconfig.build.json"),
    JSON.stringify({ compilerOptions: { emitDeclarationOnly: true }, references: [] }),
  );
  return {
    name,
    root: directory,
    manifestPath: join(directory, "package.json"),
    manifest: { dependencies, scripts: { typecheck: "tsc --noEmit" } },
    kind: "tooling" as const,
    enterprise: false,
  } satisfies ClassifiedPackage;
}

function reference(packageRoot: string, target: string): void {
  writeFileSync(
    join(packageRoot, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: { noEmit: true },
      references: [{ path: target }],
    }),
  );
  writeFileSync(
    join(packageRoot, "tsconfig.build.json"),
    JSON.stringify({
      compilerOptions: { emitDeclarationOnly: true },
      references: [{ path: target }],
    }),
  );
}

function consumerReference(packageRoot: string, target: string): void {
  writeFileSync(
    join(packageRoot, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: { noEmit: true },
      references: [{ path: target }],
    }),
  );
}

function writeSolution(packages: ClassifiedPackage[]): void {
  writeSolutionPaths(packages.map((pkg) => pkg.root + "/tsconfig.build.json"));
}

function writeSolutionPaths(paths: string[]): void {
  mkdirSync(join(root, "dev"), { recursive: true });
  writeFileSync(
    join(root, "dev/tsconfig.declarations.json"),
    JSON.stringify({
      references: paths.map((path) => ({ path })),
    }),
  );
}

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = "";
});

describe("declaration project references", () => {
  /** @scenario "Declaration producers prepare their production dependencies" */
  it("requires a producer for each TypeScript workspace dependency", () => {
    root = mkdtempSync(join(tmpdir(), "declaration-project-references-"));
    const dependency = packageFixture("@scope/dependency", "packages/dependency");
    const consumer = packageFixture("@scope/consumer", "packages/consumer", {
      "@scope/dependency": "workspace:*",
    });
    consumerReference(consumer.root, "../dependency/tsconfig.build.json");
    writeSolution([consumer, dependency]);

    expect(lintDeclarationProjectReferences(root, [consumer, dependency])).toMatchObject([
      { policy: "declaration-project-references", specifier: "@scope/dependency" },
    ]);

    reference(consumer.root, "../dependency/tsconfig.build.json");
    expect(lintDeclarationProjectReferences(root, [consumer, dependency])).toEqual([]);
  });

  it("accepts transitive producer coverage and ignores dev-only dependencies", () => {
    root = mkdtempSync(join(tmpdir(), "declaration-project-references-"));
    const leaf = packageFixture("@scope/leaf", "packages/leaf");
    const middle = packageFixture("@scope/middle", "packages/middle");
    const ignored = packageFixture("@scope/ignored", "packages/ignored");
    const consumer = packageFixture("@scope/consumer", "packages/consumer", {
      "@scope/leaf": "workspace:*",
    });
    const consumerManifest = {
      ...consumer.manifest,
      devDependencies: { "@scope/ignored": "workspace:*" },
    };
    consumer.manifest = consumerManifest;
    reference(consumer.root, "../middle/tsconfig.build.json");
    reference(middle.root, "../leaf/tsconfig.build.json");
    writeSolution([consumer, middle, leaf, ignored]);

    expect(lintDeclarationProjectReferences(root, [consumer, middle, leaf, ignored])).toEqual([]);
  });

  it("reports dangling references without requiring declaration output files", () => {
    root = mkdtempSync(join(tmpdir(), "declaration-project-references-"));
    const consumer = packageFixture("@scope/consumer", "packages/consumer");
    reference(consumer.root, "../missing/tsconfig.build.json");
    writeFileSync(
      join(consumer.root, "tsconfig.build.json"),
      JSON.stringify({
        compilerOptions: { emitDeclarationOnly: true },
        references: [{ path: "../also-missing/tsconfig.build.json" }],
      }),
    );
    writeSolution([consumer]);

    expect(lintDeclarationProjectReferences(root, [consumer])).toMatchObject([
      {
        policy: "declaration-project-references",
        file: join(consumer.root, "tsconfig.build.json"),
      },
    ]);
  });

  it("accepts a directory reference and JSONC producer config", () => {
    root = mkdtempSync(join(tmpdir(), "declaration-project-references-"));
    const producer = packageFixture("@scope/producer", "packages/producer");
    writeFileSync(
      join(producer.root, "tsconfig.json"),
      '{\n // producer config\n "compilerOptions": { "emitDeclarationOnly": true, },\n "references": [],\n}',
    );
    const consumer = packageFixture("@scope/consumer", "packages/consumer", {
      "@scope/producer": "workspace:*",
    });
    writeSolutionPaths([producer.root, join(consumer.root, "tsconfig.build.json")]);

    expect(lintDeclarationProjectReferences(root, [producer, consumer])).toMatchObject([
      { specifier: "@scope/producer" },
    ]);
    reference(consumer.root, "../producer");

    expect(lintDeclarationProjectReferences(root, [producer, consumer])).toEqual([]);
  });

  it("supports an alternate producer filename", () => {
    root = mkdtempSync(join(tmpdir(), "declaration-project-references-"));
    const producer = packageFixture("@scope/mail", "packages/mail");
    rmSync(join(producer.root, "tsconfig.build.json"));
    writeFileSync(
      join(producer.root, "tsconfig.declarations.json"),
      JSON.stringify({ compilerOptions: { emitDeclarationOnly: true }, references: [] }),
    );
    const consumer = packageFixture("@scope/consumer", "packages/consumer", {
      "@scope/mail": "workspace:*",
    });
    writeSolutionPaths([
      producer.root + "/tsconfig.declarations.json",
      join(consumer.root, "tsconfig.build.json"),
    ]);

    expect(lintDeclarationProjectReferences(root, [producer, consumer])).toMatchObject([
      { specifier: "@scope/mail" },
    ]);
    reference(consumer.root, "../mail/tsconfig.declarations.json");

    expect(lintDeclarationProjectReferences(root, [producer, consumer])).toEqual([]);
  });

  it("accepts dependencies in the same declaration group and detects external omissions", () => {
    root = mkdtempSync(join(tmpdir(), "declaration-project-references-"));
    const member = packageFixture("@scope/member", "packages/member");
    const sameGroup = packageFixture("@scope/same-group", "packages/same-group");
    const external = packageFixture("@scope/external", "packages/external");
    member.manifest.dependencies = {
      "@scope/same-group": "workspace:*",
      "@scope/external": "workspace:*",
    };
    mkdirSync(join(root, "dev"), { recursive: true });
    const group = join(root, "dev/tsconfig.web-declarations.json");
    writeFileSync(
      group,
      JSON.stringify({
        compilerOptions: { emitDeclarationOnly: true },
        references: [],
        langwatchDeclarationGroup: {
          members: [{ directory: "../packages/member" }, { directory: "../packages/same-group" }],
        },
      }),
    );
    writeSolutionPaths([group, external.root + "/tsconfig.build.json"]);

    expect(lintDeclarationProjectReferences(root, [member, sameGroup, external])).toMatchObject([
      { specifier: "@scope/external" },
    ]);
  });

  it("reports malformed producer configs and producer cycles", () => {
    root = mkdtempSync(join(tmpdir(), "declaration-project-references-"));
    const malformed = packageFixture("@scope/malformed", "packages/malformed");
    writeFileSync(join(malformed.root, "tsconfig.build.json"), "{ invalid");
    const first = packageFixture("@scope/first", "packages/first");
    const second = packageFixture("@scope/second", "packages/second");
    reference(first.root, "../second/tsconfig.build.json");
    reference(second.root, "../first/tsconfig.build.json");
    writeSolution([malformed, first, second]);

    expect(lintDeclarationProjectReferences(root, [malformed, first, second])).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: expect.stringContaining("valid JSONC") }),
        expect.objectContaining({ message: expect.stringContaining("cycle") }),
      ]),
    );
  });

  it.each(["solution", "group", "stub"])("reports dangling references in a %s", (kind) => {
    root = mkdtempSync(join(tmpdir(), "declaration-project-references-"));
    const solution = join(root, "dev/tsconfig.declarations.json");
    const intermediate = join(root, "dev/tsconfig.intermediate.json");
    const referringFile = kind === "solution" ? solution : intermediate;
    writeSolutionPaths(kind === "solution" ? ["./missing.json"] : [intermediate]);
    if (kind !== "solution") {
      writeFileSync(
        intermediate,
        JSON.stringify({
          files: [],
          references: [{ path: "./missing.json" }],
          ...(kind === "group"
            ? {
                compilerOptions: { emitDeclarationOnly: true },
                langwatchDeclarationGroup: { members: [] },
              }
            : {}),
        }),
      );
    }
    expect(lintDeclarationProjectReferences(root, [])).toMatchObject([
      { file: referringFile, message: expect.stringContaining("does not exist") },
    ]);
  });
});
