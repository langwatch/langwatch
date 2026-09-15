import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  cleanGroupArtifacts,
  copyGroupJsonInputs,
  distributeGroupArtifacts,
} from "../declaration-group-artifacts.mjs";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const compiler = join(root, "node_modules/typescript/bin/tsc");

function write(directory, path, contents) {
  const file = join(directory, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, typeof contents === "string" ? contents : JSON.stringify(contents));
}

test("groups cyclic declarations, relocates maps and JSON, and preserves runtime files", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "langwatch-declaration-group-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  write(directory, "package.json", { type: "module", private: true });
  write(directory, "tsconfig.base.json", {
    compilerOptions: {
      target: "es2022",
      module: "preserve",
      moduleResolution: "bundler",
      strict: true,
      skipLibCheck: false,
      resolveJsonModule: true,
      declaration: true,
      declarationMap: true,
      paths: {
        "@fixture/a": ["./packages/a/src/index.ts"],
        "@fixture/b": ["./packages/b/src/index.ts"],
      },
    },
  });
  for (const name of ["a", "b"]) {
    write(directory, `packages/${name}/package.json`, {
      name: `@fixture/${name}`,
      type: "module",
      imports:
        name === "a"
          ? { "#tag": { "fixture-declarations": "./dist/tag.d.ts", default: "./src/tag.ts" } }
          : {},
      exports: {
        ".": {
          types: "./dist/index.d.ts",
          default: "./src/index.ts",
        },
      },
    });
  }
  write(directory, "packages/a/src/tag.ts", 'export type Tag = "a";');
  write(directory, "packages/a/src/payload.json", { value: "ready" });
  write(directory, "packages/a/src/extra.json", { value: "remove-me" });
  write(
    directory,
    "packages/a/src/index.ts",
    'import type { B } from "@fixture/b"; import type { Tag } from "#tag"; export type A = { b: B; tag: Tag }; export const a = (b: B): A => ({ b, tag: "a" }); export { default as payload } from "./payload.json";',
  );
  write(
    directory,
    "packages/b/src/index.ts",
    'import type { A } from "@fixture/a"; export type B = { a: A }; export const b = (a: A): B => ({ a });',
  );
  write(directory, "tsconfig.group.json", {
    extends: "./tsconfig.base.json",
    compilerOptions: {
      composite: true,
      emitDeclarationOnly: true,
      noEmitOnError: true,
      rootDir: ".",
      outDir: "stage",
      tsBuildInfoFile: "stage/group.tsbuildinfo",
    },
    include: ["packages/a/src/**/*.ts", "packages/a/src/**/*.json", "packages/b/src/**/*.ts"],
  });
  const source = directory;
  const project = {
    source,
    output: join(directory, "stage"),
    members: [
      {
        directory: join(directory, "packages/a"),
        source: join(directory, "packages/a/src"),
        output: join(directory, "packages/a/dist"),
      },
      {
        directory: join(directory, "packages/b"),
        source: join(directory, "packages/b/src"),
        output: join(directory, "packages/b/dist"),
      },
    ],
  };
  copyGroupJsonInputs(project);
  const built = spawnSync(compiler, ["--project", join(directory, "tsconfig.group.json")], {
    cwd: directory,
    encoding: "utf8",
  });
  assert.equal(built.status, 0, `${built.stdout}\n${built.stderr}`);
  for (const suffix of ["mts", "cts"]) {
    write(directory, `stage/packages/a/src/types.d.${suffix}.map`, {
      version: 3,
      file: `types.d.${suffix}`,
      sources: ["../../../../packages/a/src/index.ts"],
    });
  }
  write(directory, "packages/a/dist/runtime.js", "runtime");
  write(directory, "packages/a/dist/unowned.json", { keep: true });
  write(directory, "packages/a/dist/obsolete.d.ts", "export type Obsolete = never;");
  distributeGroupArtifacts(project);
  assert.match(readFileSync(join(directory, "packages/a/dist/index.d.ts"), "utf8"), /from "#tag"/);
  assert.equal(
    JSON.parse(readFileSync(join(directory, "packages/a/dist/index.d.ts.map"))).sources[0],
    "../src/index.ts",
  );
  assert.deepEqual(JSON.parse(readFileSync(join(directory, "packages/a/dist/payload.json"))), {
    value: "ready",
  });
  assert.deepEqual(JSON.parse(readFileSync(join(directory, "packages/a/dist/extra.json"))), {
    value: "remove-me",
  });
  for (const suffix of ["mts", "cts"]) {
    assert.equal(
      JSON.parse(readFileSync(join(directory, `packages/a/dist/types.d.${suffix}.map`))).sources[0],
      "../src/index.ts",
    );
  }
  assert.equal(existsSync(join(directory, "packages/a/dist/obsolete.d.ts")), false);
  assert.equal(existsSync(join(directory, "packages/a/dist/runtime.js")), true);
  assert.equal(existsSync(join(directory, "packages/a/dist/unowned.json")), true);
  write(
    directory,
    "consumer/src/index.ts",
    'import { a } from "@fixture/a"; import { b } from "@fixture/b"; export const value = b(a({ a: undefined as never }));',
  );
  write(directory, "consumer/tsconfig.json", {
    extends: "../tsconfig.base.json",
    compilerOptions: { noEmit: true },
    include: ["src/**/*.ts"],
  });
  mkdirSync(join(directory, "consumer/node_modules/@fixture"), { recursive: true });
  symlinkSync(
    join(directory, "packages/a"),
    join(directory, "consumer/node_modules/@fixture/a"),
    "dir",
  );
  symlinkSync(
    join(directory, "packages/b"),
    join(directory, "consumer/node_modules/@fixture/b"),
    "dir",
  );
  const checked = spawnSync(compiler, ["--project", join(directory, "consumer/tsconfig.json")], {
    cwd: directory,
    encoding: "utf8",
  });
  assert.equal(checked.status, 0, `${checked.stdout}\n${checked.stderr}`);
  rmSync(join(directory, "packages/a/src/extra.json"));
  rmSync(join(directory, "stage/packages/a/src/extra.json"));
  distributeGroupArtifacts(project);
  assert.equal(existsSync(join(directory, "packages/a/dist/payload.json")), true);
  assert.equal(existsSync(join(directory, "packages/a/dist/extra.json")), false);
  cleanGroupArtifacts(project);
  assert.equal(existsSync(join(directory, "packages/a/dist/index.d.ts")), false);
  assert.equal(existsSync(join(directory, "packages/a/dist/runtime.js")), true);
  assert.equal(existsSync(join(directory, "packages/a/dist/unowned.json")), true);
});
