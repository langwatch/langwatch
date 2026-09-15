import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createInputHasher, projectsFor } from "../declaration-cache-inputs.mjs";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const script = join(root, "dev/scripts/typecheck-declarations.mjs");
const compiler = join(root, "node_modules/typescript/bin/tsc");

function write(directory, path, contents) {
  const target = join(directory, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, typeof contents === "string" ? contents : JSON.stringify(contents));
}

function fixture(parent, name) {
  const directory = join(parent, name);
  write(directory, "package.json", { type: "module", private: true });
  write(directory, "tsconfig.base.json", {
    compilerOptions: {
      target: "es2022",
      module: "preserve",
      moduleResolution: "bundler",
      types: [],
      strict: true,
    },
  });
  write(directory, "dev/tsconfig.declarations.json", {
    files: [],
    references: [{ path: "../packages/consumer/tsconfig.build.json" }],
  });
  mkdirSync(join(directory, "node_modules/.bin"), { recursive: true });
  symlinkSync(
    join(root, "node_modules/typescript"),
    join(directory, "node_modules/typescript"),
    "dir",
  );
  symlinkSync(compiler, join(directory, "node_modules/.bin/tsc"));
  for (const name of ["base", "consumer"]) {
    const packageDirectory = join(directory, "packages", name);
    write(packageDirectory, "package.json", {
      name: `@fixture/${name}`,
      type: "module",
      exports: {
        ".": {
          types: "./dist/index.d.ts",
          default: "./src/index.ts",
        },
      },
      dependencies: name === "consumer" ? { "@fixture/base": "workspace:*" } : {},
    });
    write(packageDirectory, "tsconfig.build.json", {
      extends: "../../tsconfig.base.json",
      compilerOptions: {
        composite: true,
        declaration: true,
        declarationMap: true,
        emitDeclarationOnly: true,
        noEmitOnError: true,
        rootDir: "src",
        outDir: "dist",
        tsBuildInfoFile: "dist/build.tsbuildinfo",
      },
      include: ["src/**/*.ts"],
      references: name === "consumer" ? [{ path: "../base/tsconfig.build.json" }] : [],
    });
    write(
      packageDirectory,
      "src/index.ts",
      name === "base"
        ? "export const revision = 1;"
        : 'import { revision } from "@fixture/base"; export const value = revision;',
    );
    mkdirSync(join(directory, "node_modules/@fixture"), { recursive: true });
    symlinkSync(packageDirectory, join(directory, "node_modules/@fixture", name), "dir");
  }
  return directory;
}

function groupedFixture(parent, name) {
  const directory = fixture(parent, name);
  write(directory, "dev/tsconfig.group.json", {
    extends: "../tsconfig.base.json",
    compilerOptions: {
      composite: true,
      declaration: true,
      declarationMap: true,
      emitDeclarationOnly: true,
      noEmitOnError: true,
      rootDir: "..",
      outDir: ".cache/web-declarations",
      tsBuildInfoFile: ".cache/web-declarations/group.tsbuildinfo",
    },
    include: ["../packages/base/src/**/*.ts"],
    langwatchDeclarationGroup: {
      members: [{ directory: "../packages/base", source: "src", output: "dist" }],
    },
  });
  write(directory, "packages/consumer/tsconfig.build.json", {
    extends: "../../tsconfig.base.json",
    compilerOptions: {
      composite: true,
      declaration: true,
      declarationMap: true,
      emitDeclarationOnly: true,
      noEmitOnError: true,
      rootDir: "src",
      outDir: "dist",
      tsBuildInfoFile: "dist/build.tsbuildinfo",
    },
    include: ["src/**/*.ts"],
    references: [{ path: "../../dev/tsconfig.group.json" }],
  });
  write(directory, "dev/tsconfig.declarations.json", {
    files: [],
    references: [
      { path: "./tsconfig.group.json" },
      { path: "../packages/consumer/tsconfig.build.json" },
    ],
  });
  return directory;
}

function run(directory, cache, args = []) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: directory,
    env: { ...process.env, LANGWATCH_DECLARATION_CACHE_DIR: cache },
    encoding: "utf8",
    timeout: 120_000,
  });
}

function passes(result, summary) {
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  if (summary) {
    assert.match(result.stderr, summary);
  }
}

function temporary(t) {
  const directory = mkdtempSync(join(tmpdir(), "langwatch-declaration-cache-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

/** @scenario "Another worktree restores a successful declaration build" */
test("another worktree restores usable declarations without build info or recompilation", (t) => {
  const parent = temporary(t);
  const first = fixture(parent, "first");
  const second = fixture(parent, "second");
  const cache = join(parent, "cache");
  passes(run(first, cache), /2 built, 0 cached/);
  passes(run(second, cache), /0 built, 2 cached/);
  assert.equal(existsSync(join(second, "packages/base/dist/build.tsbuildinfo")), false);
  assert.equal(existsSync(join(second, "packages/consumer/dist/build.tsbuildinfo")), false);
  assert.match(
    readFileSync(join(second, "packages/consumer/dist/index.d.ts"), "utf8"),
    /value = 1/,
  );
  write(second, "check.ts", 'import { value } from "@fixture/consumer"; const valid: 1 = value;');
  write(second, "tsconfig.json", {
    extends: "./tsconfig.base.json",
    compilerOptions: { noEmit: true },
    files: ["check.ts"],
  });
  passes(
    spawnSync(process.execPath, [compiler, "-p", "tsconfig.json"], {
      cwd: second,
      encoding: "utf8",
      timeout: 120_000,
    }),
  );
  assert.ok(
    readdirSync(cache, { recursive: true }).every((path) => !path.endsWith(".tsbuildinfo")),
  );
});

/** @scenario "A dependency changes in only one worktree" */
test("dirty dependency changes rebuild its consumer while worktrees stay isolated", (t) => {
  const parent = temporary(t);
  const first = fixture(parent, "first");
  const second = fixture(parent, "second");
  const cache = join(parent, "cache");
  passes(run(first, cache));
  passes(run(second, cache));
  write(second, "packages/base/src/index.ts", "export const revision = 2;");
  passes(run(second, cache), /2 built, 0 cached/);
  assert.match(
    readFileSync(join(second, "packages/consumer/dist/index.d.ts"), "utf8"),
    /value = 2/,
  );
  assert.match(readFileSync(join(first, "packages/consumer/dist/index.d.ts"), "utf8"), /value = 1/);
  write(first, "packages/base/src/index.ts", "export const revision = 2;");
  passes(run(first, cache), /0 built, 2 cached/);
  assert.equal(existsSync(join(first, "packages/base/dist/build.tsbuildinfo")), false);
  write(first, "packages/base/src/index.ts", "export const revision = 1;");
  passes(run(first, cache), /0 built, 2 cached/);
  assert.match(readFileSync(join(first, "packages/consumer/dist/index.d.ts"), "utf8"), /value = 1/);
});

/** @scenario "A changed consumer uses a restored dependency" */
test("a consumer miss compiles against a restored dependency without rebuilding it", (t) => {
  const parent = temporary(t);
  const first = fixture(parent, "first");
  const second = fixture(parent, "second");
  const cache = join(parent, "cache");
  passes(run(first, cache));
  write(
    second,
    "packages/consumer/src/index.ts",
    'import { revision } from "@fixture/base"; export const value = revision; export const extra = true;',
  );
  passes(run(second, cache), /1 built, 1 cached/);
  assert.equal(existsSync(join(second, "packages/base/dist/build.tsbuildinfo")), false);
  assert.match(
    readFileSync(join(second, "packages/consumer/dist/index.d.ts"), "utf8"),
    /extra = true/,
  );
});

/** @scenario "A compilation fails" */
test("failed compilation is never cached and blocks dependent compilation", (t) => {
  const parent = temporary(t);
  const directory = fixture(parent, "worktree");
  const cache = join(parent, "cache");
  write(directory, "packages/base/src/index.ts", 'export const revision: number = "wrong";');
  const failed = run(directory, cache);
  assert.notEqual(failed.status, 0);
  assert.match(failed.stdout, /TS2322/);
  assert.equal(existsSync(cache), false);
  assert.equal(existsSync(join(directory, "packages/consumer/dist/index.d.ts")), false);
  write(directory, "packages/base/src/index.ts", "export const revision = 1;");
  passes(run(directory, cache), /2 built, 0 cached/);
});

/** @scenario "Cached artifacts are incomplete or corrupt" */
test("incomplete or corrupt cache entries are misses and cannot restore invalid types", (t) => {
  const parent = temporary(t);
  const first = fixture(parent, "first");
  const second = fixture(parent, "second");
  const cache = join(parent, "cache");
  passes(run(first, cache));
  for (const entry of readdirSync(cache)) {
    write(cache, `${entry}/files/index.d.ts`, "export const corrupted: never;");
  }
  passes(run(second, cache), /2 built, 0 cached/);
  assert.match(
    readFileSync(join(second, "packages/consumer/dist/index.d.ts"), "utf8"),
    /value = 1/,
  );
});

test("source, config, dependency, lockfile and compiler contents participate in keys", (t) => {
  const parent = temporary(t);
  const directory = fixture(parent, "worktree");
  const projects = projectsFor(directory, "dev/tsconfig.declarations.json");
  const key = () => createInputHasher(directory, projects, [], true)(projects[1]);
  let before = key();
  for (const [file, contents] of [
    ["packages/base/src/extra.ts", "export const extra = true;"],
    ["tsconfig.base.json", { compilerOptions: { target: "es2020", strict: true } }],
    ["pnpm-lock.yaml", "lockfileVersion: '9.0'"],
    [
      "packages/base/package.json",
      { name: "@fixture/base", dependencies: { "extra-types": "1.0.0" } },
    ],
    [
      "node_modules/extra-types/package.json",
      { name: "extra-types", version: "1.0.0", types: "index.d.ts" },
    ],
    ["node_modules/extra-types/index.d.ts", "export type Changed = string;"],
  ]) {
    write(directory, file, contents);
    const after = key();
    assert.notEqual(after, before, file);
    before = after;
  }
  const originalCompiler = join(directory, "node_modules/typescript");
  unlinkSync(originalCompiler);
  write(directory, "node_modules/typescript/package.json", {
    name: "typescript",
    version: "7.0.2",
  });
  write(directory, "node_modules/typescript/compiler.js", "changed compiler");
  assert.notEqual(key(), before);
});

/** @scenario "Two worktrees publish the same build concurrently" */
test("concurrent worktrees publish complete entries and keep independent output files", async (t) => {
  const parent = temporary(t);
  const first = fixture(parent, "first");
  const second = fixture(parent, "second");
  const cache = join(parent, "cache");
  function concurrent(directory) {
    return new Promise((done, reject) => {
      const child = spawn(process.execPath, [script], {
        cwd: directory,
        env: { ...process.env, LANGWATCH_DECLARATION_CACHE_DIR: cache },
      });
      let output = "";
      child.stdout.on("data", (chunk) => {
        output += chunk;
      });
      child.stderr.on("data", (chunk) => {
        output += chunk;
      });
      child.on("error", reject);
      child.on("exit", (code) => (code === 0 ? done() : reject(new Error(output))));
    });
  }
  await Promise.all([concurrent(first), concurrent(second)]);
  assert.equal(readdirSync(cache).length, 2);
  passes(run(first, cache), /0 built, 2 cached/);
  write(first, "packages/base/dist/index.d.ts", "locally corrupted");
  assert.match(readFileSync(join(second, "packages/base/dist/index.d.ts"), "utf8"), /revision = 1/);
  passes(run(first, cache), /0 built, 2 cached/);
  assert.match(readFileSync(join(first, "packages/base/dist/index.d.ts"), "utf8"), /revision = 1/);
});

test("test-only workspace source does not invalidate production declarations", (t) => {
  const parent = temporary(t);
  const directory = fixture(parent, "worktree");
  const projects = projectsFor(directory, "dev/tsconfig.declarations.json");
  const helper = join(directory, "packages/test-helper");
  write(helper, "package.json", { name: "@fixture/test-helper", version: "1.0.0" });
  write(helper, "src/index.ts", "export const helper = 1;");
  symlinkSync(helper, join(directory, "node_modules/@fixture/test-helper"), "dir");
  const manifest = JSON.parse(
    readFileSync(join(directory, "packages/consumer/package.json"), "utf8"),
  );
  manifest.devDependencies = { "@fixture/test-helper": "workspace:*" };
  write(directory, "packages/consumer/package.json", manifest);
  const key = () => createInputHasher(directory, projects)(projects[1]);
  const before = key();
  write(helper, "src/index.ts", "export const helper = 2;");
  assert.equal(key(), before);
  write(directory, "packages/base/src/index.ts", "export const revision = 2;");
  assert.notEqual(key(), before);
});

test("clean removes local outputs, force bypasses reuse, and deleted sources leave no stale declarations", (t) => {
  const parent = temporary(t);
  const directory = fixture(parent, "worktree");
  const cache = join(parent, "cache");
  write(directory, "packages/base/src/removed.ts", "export const obsolete = true;");
  passes(run(directory, cache), /2 built, 0 cached/);
  const removed = join(directory, "packages/base/dist/removed.d.ts");
  assert.equal(existsSync(removed), true);
  rmSync(join(directory, "packages/base/src/removed.ts"));
  passes(run(directory, cache), /2 built, 0 cached/);
  assert.equal(existsSync(removed), false);
  passes(run(directory, cache, ["--clean"]));
  assert.equal(existsSync(join(directory, "packages/base/dist/index.d.ts")), false);
  passes(run(directory, cache), /0 built, 2 cached/);
  passes(run(directory, cache, ["--force"]), /2 built, 0 cached/);
});

test("grouped declaration inputs hash member packages without treating the config directory as a package", (t) => {
  const parent = temporary(t);
  const directory = fixture(parent, "worktree");
  write(directory, "dev/tsconfig.web-declarations.json", {
    compilerOptions: {
      composite: true,
      declaration: true,
      declarationMap: true,
      emitDeclarationOnly: true,
      rootDir: "..",
      outDir: ".cache/web-declarations",
      tsBuildInfoFile: ".cache/web-declarations/build.tsbuildinfo",
    },
    langwatchDeclarationGroup: {
      members: [
        { directory: "../packages/base", source: "src", output: "dist" },
        { directory: "../packages/consumer", source: "src", output: "dist" },
      ],
    },
    references: [
      { path: "../packages/base/tsconfig.build.json" },
      { path: "../packages/consumer/tsconfig.build.json" },
    ],
  });
  write(directory, "dev/tsconfig.declarations.json", {
    files: [],
    references: [{ path: "./tsconfig.web-declarations.json" }],
  });
  const projects = projectsFor(directory, "dev/tsconfig.declarations.json");
  const group = projects.at(-1);
  assert.equal(group.members.length, 2);
  assert.doesNotThrow(() => createInputHasher(directory, projects, [], true)(group));
});

test("a changed grouped member invalidates the group key while generated member output does not", (t) => {
  const parent = temporary(t);
  const directory = fixture(parent, "worktree");
  write(directory, "dev/tsconfig.web-declarations.json", {
    compilerOptions: {
      composite: true,
      declaration: true,
      emitDeclarationOnly: true,
      rootDir: "..",
      outDir: ".cache/web-declarations",
      tsBuildInfoFile: ".cache/web-declarations/build.tsbuildinfo",
    },
    langwatchDeclarationGroup: {
      members: [{ directory: "../packages/base", source: "src", output: "dist" }],
    },
  });
  write(directory, "dev/tsconfig.declarations.json", {
    files: [],
    references: [{ path: "./tsconfig.web-declarations.json" }],
  });
  const projects = projectsFor(directory, "dev/tsconfig.declarations.json");
  const group = projects.at(-1);
  const key = () => createInputHasher(directory, projects, [], true)(group);
  const before = key();
  write(directory, "packages/base/dist/index.d.ts", "generated output");
  assert.equal(key(), before);
  write(directory, "packages/base/src/index.ts", "export const revision = 2;");
  assert.notEqual(key(), before);
});

test("group member output cannot be the workspace root", (t) => {
  const parent = temporary(t);
  const directory = fixture(parent, "worktree");
  write(directory, "dev/tsconfig.web-declarations.json", {
    compilerOptions: {
      composite: true,
      declaration: true,
      emitDeclarationOnly: true,
      rootDir: "..",
      outDir: ".cache/web-declarations",
      tsBuildInfoFile: ".cache/web-declarations/build.tsbuildinfo",
    },
    langwatchDeclarationGroup: {
      members: [{ directory: "../packages/base", source: "src", output: "../.." }],
    },
  });
  write(directory, "dev/tsconfig.declarations.json", {
    files: [],
    references: [{ path: "./tsconfig.web-declarations.json" }],
  });
  assert.throws(
    () => projectsFor(directory, "dev/tsconfig.declarations.json"),
    /Invalid declaration group member/,
  );
});

test("grouped declarations build, restore, invalidate, and clean through the real runner", (t) => {
  const parent = temporary(t);
  const first = groupedFixture(parent, "first");
  const second = groupedFixture(parent, "second");
  const cache = join(parent, "cache");
  write(first, "packages/base/dist/runtime.json", { keep: true });
  write(first, "packages/base/dist/runtime.js", "keep");
  write(second, "packages/base/dist/runtime.json", { keep: true });
  write(second, "packages/base/dist/runtime.js", "keep");
  write(first, "check.ts", 'import { value } from "@fixture/consumer"; const valid: 1 = value;');
  write(second, "check.ts", 'import { value } from "@fixture/consumer"; const valid: 1 = value;');
  write(first, "tsconfig.json", {
    extends: "./tsconfig.base.json",
    compilerOptions: { noEmit: true, skipLibCheck: false },
    files: ["check.ts"],
  });
  write(second, "tsconfig.json", {
    extends: "./tsconfig.base.json",
    compilerOptions: { noEmit: true, skipLibCheck: false },
    files: ["check.ts"],
  });

  passes(run(first, cache), /2 built, 0 cached/);
  assert.ok(existsSync(join(first, "packages/base/dist/index.d.ts")));
  passes(run(second, cache), /0 built, 2 cached/);
  passes(
    spawnSync(process.execPath, [compiler, "-p", "tsconfig.json"], {
      cwd: second,
      encoding: "utf8",
      timeout: 120_000,
    }),
  );

  write(second, "packages/base/src/index.ts", "export const revision = 2;");
  write(
    second,
    "packages/consumer/src/index.ts",
    'import { revision } from "@fixture/base"; export const value = revision;',
  );
  passes(run(second, cache), /2 built, 0 cached/);
  assert.match(readFileSync(join(second, "packages/consumer/dist/index.d.ts"), "utf8"), /value/);

  passes(run(second, cache, ["--clean"]));
  assert.equal(existsSync(join(second, "packages/base/dist/index.d.ts")), false);
  assert.deepEqual(
    JSON.parse(readFileSync(join(second, "packages/base/dist/runtime.json"), "utf8")),
    { keep: true },
  );
  assert.equal(readFileSync(join(second, "packages/base/dist/runtime.js"), "utf8"), "keep");
  passes(run(second, cache), /0 built, 2 cached/);
});

test("a failed grouped declaration build publishes nothing and skips its consumer", (t) => {
  const parent = temporary(t);
  const directory = groupedFixture(parent, "failed");
  const cache = join(parent, "cache");
  write(directory, "packages/base/src/index.ts", 'export const revision: number = "wrong";');
  const result = run(directory, cache);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /TS2322/);
  assert.equal(existsSync(join(directory, "packages/base/dist/index.d.ts")), false);
  assert.equal(existsSync(cache), false);
  assert.equal(existsSync(join(directory, "packages/consumer/dist/index.d.ts")), false);
});

test("cyclic references fail before invoking the compiler or creating outputs", (t) => {
  const parent = temporary(t);
  const directory = fixture(parent, "worktree");
  const path = "packages/base/tsconfig.build.json";
  const config = JSON.parse(readFileSync(join(directory, path), "utf8"));
  config.references = [{ path: "../consumer/tsconfig.build.json" }];
  write(directory, path, config);
  const result = run(directory, join(parent, "cache"));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Circular declaration project reference/);
  assert.equal(existsSync(join(directory, "packages/base/dist")), false);
});

/** @scenario "Public declarations re-export JSON" */
test("JSON re-exports typecheck after a build and cache restore without deleting unrelated runtime outputs", (t) => {
  const parent = temporary(t);
  const first = fixture(parent, "first");
  const second = fixture(parent, "second");
  const cache = join(parent, "cache");
  for (const directory of [first, second]) {
    const config = JSON.parse(readFileSync(join(directory, "tsconfig.base.json"), "utf8"));
    config.compilerOptions.resolveJsonModule = true;
    config.compilerOptions.skipLibCheck = false;
    write(directory, "tsconfig.base.json", config);
    const producer = JSON.parse(
      readFileSync(join(directory, "packages/base/tsconfig.build.json"), "utf8"),
    );
    producer.include.push("src/**/*.json");
    write(directory, "packages/base/tsconfig.build.json", producer);
    write(directory, "packages/base/src/payload.json", { value: "ready" });
    write(
      directory,
      "packages/base/src/index.ts",
      'export const revision = 1; export { default as payload } from "./payload.json";',
    );
    write(directory, "packages/consumer/src/index.ts", 'export { payload } from "@fixture/base";');
    write(directory, "packages/base/dist/runtime.json", { unrelated: true });
    write(
      directory,
      "check.ts",
      'import { payload } from "@fixture/consumer"; const valid: string = payload.value;',
    );
    write(directory, "tsconfig.json", {
      extends: "./tsconfig.base.json",
      compilerOptions: { noEmit: true },
      files: ["check.ts"],
    });
  }
  passes(run(first, cache), /2 built, 0 cached/);
  assert.match(readFileSync(join(first, "packages/base/dist/index.d.ts"), "utf8"), /payload.json/);
  passes(run(second, cache), /0 built, 2 cached/);
  for (const directory of [first, second]) {
    passes(
      spawnSync(process.execPath, [compiler, "-p", "tsconfig.json"], {
        cwd: directory,
        encoding: "utf8",
        timeout: 120_000,
      }),
    );
    assert.deepEqual(
      JSON.parse(readFileSync(join(directory, "packages/base/dist/payload.json"), "utf8")),
      { value: "ready" },
    );
    assert.deepEqual(
      JSON.parse(readFileSync(join(directory, "packages/base/dist/runtime.json"), "utf8")),
      { unrelated: true },
    );
  }
  passes(run(second, cache, ["--clean"]));
  assert.equal(existsSync(join(second, "packages/base/dist/payload.json")), false);
  assert.equal(existsSync(join(second, "packages/base/dist/runtime.json")), true);
  passes(run(second, cache), /0 built, 2 cached/);
  rmSync(join(second, "packages/base/src/payload.json"));
  write(second, "packages/base/src/index.ts", "export const revision = 1;");
  write(second, "packages/consumer/src/index.ts", 'export { revision } from "@fixture/base";');
  passes(run(second, cache), /2 built, 0 cached/);
  assert.equal(existsSync(join(second, "packages/base/dist/payload.json")), false);
  assert.equal(existsSync(join(second, "packages/base/dist/runtime.json")), true);
});

test("a no-emit consumer prepares references while skipping unrelated projects", (t) => {
  const parent = temporary(t);
  const directory = fixture(parent, "selected");
  const cache = join(parent, "cache");
  write(directory, "apps/worker/tsconfig.declarations.json", {
    compilerOptions: { noEmit: true },
    files: ["./worker.ts"],
    references: [{ path: "../../packages/consumer/tsconfig.build.json" }],
  });
  write(directory, "apps/worker/worker.ts", 'const consumerError: number = "checked separately";');
  const config = JSON.parse(
    readFileSync(join(directory, "packages/base/tsconfig.build.json"), "utf8"),
  );
  write(directory, "packages/unrelated/tsconfig.build.json", config);
  write(directory, "packages/unrelated/package.json", { name: "@fixture/unrelated" });
  write(directory, "packages/unrelated/src/index.ts", 'export const value: number = "invalid";');
  write(directory, "dev/tsconfig.declarations.json", {
    files: [],
    references: [
      { path: "../packages/consumer/tsconfig.build.json" },
      { path: "../packages/unrelated/tsconfig.build.json" },
    ],
  });
  const args = ["--project", "apps/worker/tsconfig.declarations.json"];
  passes(run(directory, cache, args), /2 built, 0 cached/);
  assert.equal(existsSync(join(directory, "packages/base/dist/index.d.ts")), true);
  assert.equal(existsSync(join(directory, "packages/unrelated/dist/index.d.ts")), false);
  const full = run(directory, cache);
  assert.notEqual(full.status, 0);
  assert.match(full.stdout + full.stderr, /not assignable to type 'number'/);
  write(directory, "packages/base/src/index.ts", "export const revision = 2;");
  passes(run(directory, cache, args), /2 built, 0 cached/);
  assert.match(
    readFileSync(join(directory, "packages/consumer/dist/index.d.ts"), "utf8"),
    /value = 2/,
  );
});

test("a selected group reuses the global cache entry and cleans only its own outputs", (t) => {
  const parent = temporary(t);
  const directory = groupedFixture(parent, "selected-group");
  const cache = join(parent, "cache");
  write(directory, "apps/ui/tsconfig.declarations.json", {
    files: [],
    references: [{ path: "../../dev/tsconfig.group.json" }],
  });
  const args = ["-p", "apps/ui/tsconfig.declarations.json"];
  passes(run(directory, cache, args), /1 built, 0 cached/);
  assert.equal(existsSync(join(directory, "packages/base/dist/index.d.ts")), true);
  assert.equal(existsSync(join(directory, "packages/consumer/dist/index.d.ts")), false);
  passes(run(directory, cache), /1 built, 1 cached/);
  passes(run(directory, cache, args), /0 built, 1 cached/);
  passes(run(directory, cache, [...args, "--clean"]));
  assert.equal(existsSync(join(directory, "packages/base/dist/index.d.ts")), false);
  assert.equal(existsSync(join(directory, "packages/consumer/dist/index.d.ts")), true);
});

test("invalid project selections fail before compilation", (t) => {
  const parent = temporary(t);
  const directory = fixture(parent, "invalid-project");
  const cache = join(parent, "cache");
  for (const args of [["--project", "missing.json"], ["--project"], ["-p", "--clean"]]) {
    const result = run(directory, cache, args);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /ENOENT|--project requires/);
  }
  assert.equal(existsSync(join(directory, "packages/base/dist/index.d.ts")), false);
});
