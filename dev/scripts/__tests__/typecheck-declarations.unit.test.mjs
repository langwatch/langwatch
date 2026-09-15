import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { readJson } from "../declaration-cache-inputs.mjs";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const queue = join(root, "dev/scripts/check-queue.mjs");
const compiler = join(root, "node_modules/typescript/bin/tsc");
const packages = ["actor", "time"];

function write(directory, file, contents) {
  const target = join(directory, file);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, contents);
}

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "langwatch-declarations-"));
  cpSync(join(root, "tsconfig.base.json"), join(directory, "tsconfig.base.json"));
  write(directory, "package.json", '{"type":"module"}');
  write(
    directory,
    "dev/tsconfig.declarations.json",
    JSON.stringify({
      files: [],
      references: packages.map((name) => ({ path: `../packages/${name}/tsconfig.build.json` })),
    }),
  );
  mkdirSync(join(directory, "node_modules/@langwatch"), { recursive: true });

  for (const name of packages) {
    const source = join(root, "packages", name);
    const target = join(directory, "packages", name);
    mkdirSync(target, { recursive: true });
    for (const file of ["package.json", "tsconfig.json", "tsconfig.build.json"]) {
      cpSync(join(source, file), join(target, file));
    }
    cpSync(join(source, "src"), join(target, "src"), {
      recursive: true,
      filter: (path) => !path.includes("__tests__"),
    });
    symlinkSync(join(source, "node_modules"), join(target, "node_modules"), "dir");
    symlinkSync(target, join(directory, "node_modules/@langwatch", name), "dir");
  }

  write(
    directory,
    "consumer.ts",
    [
      'import { ledgerActorFor } from "@langwatch/actor";',
      'import { fromDate } from "@langwatch/time";',
      'import "@langwatch/time/polyfill";',
      'export const actor = ledgerActorFor({ fallback: "managementApi" });',
      "export const instant = fromDate(new Date());",
    ].join("\n"),
  );
  write(
    directory,
    "tsconfig.json",
    JSON.stringify({
      extends: "./tsconfig.base.json",
      compilerOptions: {
        types: [],
        incremental: false,
      },
      files: ["consumer.ts"],
    }),
  );
  return directory;
}

function tsc(directory, args) {
  return spawnSync(process.execPath, [queue, process.execPath, compiler, ...args], {
    cwd: directory,
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 4 * 1024 * 1024,
  });
}

function passes(result) {
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
}

function build(directory) {
  return tsc(directory, ["--build", "dev/tsconfig.declarations.json", "--stopBuildOnErrors"]);
}

function emittedActor(directory) {
  return readFileSync(join(directory, "packages/actor/dist/index.d.ts"), "utf8");
}

test("the adopted packages build and a consumer loads declarations for every export", () => {
  const directory = fixture();
  try {
    passes(build(directory));
    const consumer = tsc(directory, ["-p", "tsconfig.json", "--listFiles"]);
    passes(consumer);
    for (const name of packages) {
      assert.ok(consumer.stdout.includes(`/packages/${name}/dist/index.d.ts`));
      assert.ok(!consumer.stdout.includes(`/packages/${name}/src/`));
    }
    assert.ok(consumer.stdout.includes("/time/dist/polyfill.d.ts"));

    const clean = tsc(directory, [
      "--build",
      "dev/tsconfig.declarations.json",
      "--stopBuildOnErrors",
      "--clean",
    ]);
    passes(clean);
    for (const name of packages) {
      const output = join(directory, "packages", name, "dist");
      assert.equal(existsSync(join(output, "index.d.ts")), false);
      assert.equal(existsSync(join(output, "tsconfig.build.tsbuildinfo")), false);
    }
    passes(build(directory));
    passes(tsc(directory, ["-p", "tsconfig.json"]));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("type consumers use declarations after build while runtime keeps source default", () => {
  const directory = fixture();
  try {
    const config = JSON.parse(readFileSync(join(directory, "tsconfig.json"), "utf8"));
    config.compilerOptions.customConditions = [];
    write(directory, "tsconfig.json", JSON.stringify(config));
    const beforeBuild = tsc(directory, ["-p", "tsconfig.json", "--listFiles"]);
    passes(beforeBuild);
    assert.match(beforeBuild.stdout, /packages\/actor\/src\//);
    assert.equal(
      JSON.parse(readFileSync(join(directory, "packages/actor/package.json"))).exports["."].default,
      "./src/index.ts",
    );
    passes(build(directory));
    const afterBuild = tsc(directory, ["-p", "tsconfig.json", "--listFiles"]);
    passes(afterBuild);
    assert.match(afterBuild.stdout, /packages\/actor\/dist\/index\.d\.ts/);
    write(
      directory,
      "consumer.ts",
      'import { ledgerActorFor } from "@langwatch/actor"; ledgerActorFor("invalid");',
    );
    const invalid = tsc(directory, ["-p", "tsconfig.json"]);
    assert.notEqual(invalid.status, 0);
    assert.match(invalid.stdout, /TS2345/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("worktrees keep independent outputs and rebuild changed source without publishing errors", () => {
  const first = fixture();
  const second = fixture();
  try {
    const actor = readFileSync(join(first, "packages/actor/src/index.ts"), "utf8");
    write(
      first,
      "packages/actor/src/index.ts",
      `${actor}\nexport const declarationRevision = 1;\n`,
    );
    write(
      second,
      "packages/actor/src/index.ts",
      `${actor}\nexport const declarationRevision = 2;\n`,
    );
    passes(build(first));
    passes(build(second));
    assert.match(emittedActor(first), /declarationRevision = 1/);
    assert.match(emittedActor(second), /declarationRevision = 2/);

    write(
      first,
      "packages/actor/src/index.ts",
      `${actor}\nexport const declarationRevision = 3;\n`,
    );
    passes(build(first));
    assert.match(emittedActor(first), /declarationRevision = 3/);
    assert.match(emittedActor(second), /declarationRevision = 2/);

    write(
      first,
      "packages/actor/src/index.ts",
      `${actor}\nexport const declarationRevision: number = "invalid";\n`,
    );
    const invalid = build(first);
    assert.notEqual(invalid.status, 0);
    assert.match(invalid.stdout, /TS2322/);
    assert.match(emittedActor(first), /declarationRevision = 3/);
    assert.match(emittedActor(second), /declarationRevision = 2/);
  } finally {
    rmSync(first, { recursive: true, force: true });
    rmSync(second, { recursive: true, force: true });
  }
});

test("private package imports use source during emission and declarations in consumers", () => {
  const directory = fixture();
  try {
    const manifestFile = join(directory, "packages/actor/package.json");
    const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
    manifest.imports = {
      "#*": {
        types: "./dist/*.d.ts",
        default: "./src/*.ts",
      },
    };
    writeFileSync(manifestFile, JSON.stringify(manifest));
    write(directory, "packages/actor/src/detail.ts", "export const detail = 123;");
    const index = join(directory, "packages/actor/src/index.ts");
    writeFileSync(index, readFileSync(index, "utf8") + '\nexport { detail } from "#detail";\n');
    const configFile = join(directory, "packages/actor/tsconfig.build.json");
    const config = JSON.parse(readFileSync(configFile, "utf8"));
    writeFileSync(configFile, JSON.stringify(config));
    passes(build(directory));
    const checked = tsc(directory, ["--noEmit", "--listFiles", "-p", "tsconfig.json"]);
    passes(checked);
    assert.ok(checked.stdout.includes("/packages/actor/dist/detail.d.ts"));
    assert.ok(!checked.stdout.includes("/packages/actor/src/detail.ts"));

    const localConfigFile = join(directory, "packages/actor/tsconfig.json");
    const localConfig = readJson(localConfigFile);
    Object.assign(localConfig.compilerOptions, {
      noEmit: true,
      rootDir: "src",
      outDir: "dist",
      incremental: false,
    });
    writeFileSync(localConfigFile, JSON.stringify(localConfig));
    write(directory, "packages/actor/src/detail.ts", "export const detail = 456;");
    write(
      directory,
      "packages/time/src/index.ts",
      'export const broken: number = "dependency source must not be checked";',
    );
    write(
      directory,
      "packages/actor/src/current-source.ts",
      [
        'import { detail } from "#detail";',
        'import { detail as publicDetail } from "@langwatch/actor";',
        'import { fromDate } from "@langwatch/time";',
        "export const privateValue: 456 = detail;",
        "export const publicValue: 456 = publicDetail;",
        "export const instant = fromDate(new Date());",
      ].join("\n"),
    );
    const local = tsc(directory, ["--listFiles", "-p", "packages/actor/tsconfig.json"]);
    passes(local);
    assert.ok(local.stdout.includes("/packages/actor/dist/detail.d.ts"));
    assert.ok(!local.stdout.includes("/packages/actor/src/detail.ts"));
    write(directory, "packages/actor/src/detail.ts", "export const detail = 789;");
    passes(tsc(directory, ["-p", "packages/actor/tsconfig.json"]));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("member checks use a prepared producer before checking outside-src roots", () => {
  const directory = fixture();
  try {
    const manifestFile = join(directory, "packages/actor/package.json");
    const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
    manifest.imports = {
      "#*": {
        types: "./dist/*.d.ts",
        default: "./src/*.ts",
      },
    };
    writeFileSync(manifestFile, JSON.stringify(manifest));
    const actorIndex = join(directory, "packages/actor/src/index.ts");
    writeFileSync(
      actorIndex,
      `${readFileSync(actorIndex, "utf8")}\nexport { detail } from "#detail";\n`,
    );

    const buildConfigFile = join(directory, "packages/actor/tsconfig.build.json");
    const buildConfig = JSON.parse(readFileSync(buildConfigFile, "utf8"));
    Object.assign(buildConfig.compilerOptions, {
      rootDir: "src",
      outDir: "dist",
      incremental: true,
      rewriteRelativeImportExtensions: false,
    });
    writeFileSync(buildConfigFile, JSON.stringify(buildConfig));
    write(directory, "packages/actor/src/detail.ts", "export const detail = 456;");
    write(
      directory,
      "packages/actor/tests/current-source.ts",
      [
        'import { detail } from "#detail";',
        'import { detail as publicDetail } from "@langwatch/actor";',
        'import { fromDate } from "@langwatch/time";',
        "export const privateValue: 456 = detail;",
        "export const publicValue: 456 = publicDetail;",
        "export const instant = fromDate(new Date());",
      ].join("\n"),
    );
    write(
      directory,
      "packages/actor/tests/actor-check.ts",
      'import { detail } from "../src/detail.ts"; export const testValue = detail;',
    );
    write(
      directory,
      "packages/actor/vitest.setup.ts",
      'import { detail } from "#detail"; export const setupValue = detail;',
    );
    const localConfigFile = join(directory, "packages/actor/tsconfig.json");
    const localConfig = readJson(localConfigFile);
    Object.assign(localConfig.compilerOptions, {
      noEmit: true,
      rootDir: ".",
      outDir: "dist",
      incremental: false,
      rewriteRelativeImportExtensions: false,
    });
    localConfig.include = ["src/**/*.ts", "tests/**/*.ts", "vitest.setup.ts"];
    localConfig.references = [{ path: "./tsconfig.build.json" }];
    writeFileSync(localConfigFile, JSON.stringify(localConfig));

    passes(tsc(directory, ["-p", "packages/actor/tsconfig.build.json"]));
    const checked = tsc(directory, ["-p", "packages/actor/tsconfig.json"]);
    passes(checked);
    write(directory, "packages/actor/src/detail.ts", "export const detail = 789;");
    passes(tsc(directory, ["-p", "packages/actor/tsconfig.build.json"]));
    const stale = tsc(directory, ["-p", "packages/actor/tsconfig.json"]);
    assert.notEqual(stale.status, 0);
    assert.equal((stale.stdout.match(/TS2322/g) ?? []).length, 2);
    write(directory, "packages/actor/src/detail.ts", 'export const detail: number = "broken";');
    const invalid = tsc(directory, ["-p", "packages/actor/tsconfig.build.json"]);
    assert.notEqual(invalid.status, 0);
    assert.match(invalid.stdout, /TS2322/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
