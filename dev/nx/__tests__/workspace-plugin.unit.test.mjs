import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, matchesGlob } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { sourceOnlyDependencies, typecheckTarget } from "../typecheck-plugin.mjs";
import { createNodes } from "../workspace-plugin.mjs";

const workspaceRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const [, create] = createNodes;
const [[, { projects }]] = create(["nx.json"], {}, { workspaceRoot });
const { targets } = projects["dev/nx"];

void describe("workspace targets", () => {
  /** @scenario "The source typecheck and the plain lint replay from the cache" */
  void it("caches the source typecheck and the plain lint", () => {
    assert.equal(targets["typecheck:src"].cache, true);
    assert.equal(targets["lint:tree"].cache, true);
    assert.equal(targets.typecheck, undefined);
    assert.equal(targets["lint:tree:types"], undefined);
  });

  /** @scenario "The source typecheck and the plain lint replay from the cache" */
  void it("hashes the sources of what tsc reads and of the files its dependencies generate", () => {
    const { inputs, dependsOn } = targets["typecheck:src"];
    assert.ok(inputs.includes("{workspaceRoot}/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs,json}"));
    assert.ok(inputs.includes("{workspaceRoot}/**/*.prisma"));
    assert.ok(inputs.every((input) => input.dependentTasksOutputFiles === undefined));
    assert.ok(dependsOn.includes("@langwatch/prisma-client:prisma:generate"));
  });
});

void describe("per-project typecheck", () => {
  const time = typecheckTarget(workspaceRoot, "packages/time");

  /** @scenario "A project's typecheck replays unless its own files or its dependencies' declarations changed" */
  void it("runs after its dependencies' typecheck and hashes the declarations they emit", () => {
    assert.equal(time.cache, true);
    assert.ok(time.dependsOn.includes("^typecheck"));
    assert.ok(time.inputs.includes("default"));
    assert.ok(!time.inputs.includes("^production"));
    const emitted = time.inputs.find((input) => input.dependentTasksOutputFiles !== undefined);
    assert.equal(emitted.transitive, true);
  });

  /** @scenario "A change that keeps a package's declarations replays its dependants" */
  void it("hashes what its dependencies emit, not their sources", () => {
    assert.ok(time.inputs.every((input) => typeof input !== "string" || !input.startsWith("^")));
    const { dependentTasksOutputFiles: glob } = time.inputs.find(
      (input) => input.dependentTasksOutputFiles !== undefined,
    );
    assert.ok(matchesGlob("packages/time/dist/index.d.ts", glob));
    assert.ok(!matchesGlob("sdks/typescript/dist/index.js", glob));
    assert.ok(!matchesGlob("packages/time/dist/tsconfig.build.tsbuildinfo", glob));
  });

  /** @scenario "A project's typecheck replays unless its own files or its dependencies' declarations changed" */
  void it("declares the declarations it writes as globs, never a dist directory", () => {
    assert.ok(time.outputs.includes("{workspaceRoot}/packages/time/dist/**/*.d.ts"));
    assert.ok(time.outputs.every((output) => !output.endsWith("/dist")));
    assert.ok(time.outputs.includes("{workspaceRoot}/packages/time/dist/**/*.tsbuildinfo"));
  });

  /** @scenario "A typecheck hashes the configs it extends and the sources of dependencies with no declarations" */
  void it("hashes the root configs its own configs extend", () => {
    assert.ok(time.inputs.includes("{workspaceRoot}/tsconfig.emit.json"));
    assert.ok(time.inputs.includes("{workspaceRoot}/tsconfig.base.json"));
  });

  /** @scenario "A typecheck hashes the configs it extends and the sources of dependencies with no declarations" */
  void it("hashes the production files of dependencies read from source, not devDependencies' own", () => {
    const dirsByName = new Map([
      ["langwatch", "sdks/typescript"],
      ["@langwatch/e2e-stack", "dev/tests/e2e-stack"],
      ["@langwatch/platform-api", "apps/api"],
    ]);
    const sdk = sourceOnlyDependencies(workspaceRoot, "sdks/typescript", dirsByName);
    assert.deepEqual(sdk, ["@langwatch/e2e-stack"]);
    const target = typecheckTarget(workspaceRoot, "sdks/typescript", dirsByName);
    assert.ok(
      target.inputs.some(
        (input) => input.input === "production" && input.projects.includes("@langwatch/e2e-stack"),
      ),
    );
    // The SDK's devDependency on e2e-stack never reaches the SDK's dependants.
    const dependant = typecheckTarget(workspaceRoot, "modules/analytics/process", dirsByName);
    assert.ok(dependant.inputs.every((input) => input.projects === undefined));
  });

  /** @scenario "Generated sources and built declarations exist before a project's typecheck" */
  void it("runs the project's own generators and, when its published types are built, its build", () => {
    const prisma = typecheckTarget(workspaceRoot, "packages/prisma-client");
    assert.ok(prisma.dependsOn.includes("prisma:generate"));
    assert.ok(typecheckTarget(workspaceRoot, "sdks/typescript").dependsOn.includes("build"));
    assert.ok(!time.dependsOn.includes("build"));
    // ksuid's build and its tsc both write dist/*.d.ts; typecheck runs last and owns them.
    const ksuid = typecheckTarget(workspaceRoot, "packages/ksuid");
    assert.ok(ksuid.dependsOn.includes("build"));
    assert.ok(ksuid.outputs.includes("{workspaceRoot}/packages/ksuid/dist/**/*.d.ts"));
  });

  /** @scenario "Build info written outside dist is a typecheck output" */
  void it("declares build info a config writes outside its dist", () => {
    const { outputs } = typecheckTarget(workspaceRoot, "apps/docs");
    assert.ok(outputs.includes("{workspaceRoot}/apps/docs/.tsbuild/tsconfig.tsbuildinfo"));
  });
});

void describe("nightly uncached checks", () => {
  const nightly = readFileSync(join(workspaceRoot, ".github/workflows/nightly.yml"), "utf8");
  const job = nightly.slice(
    nightly.indexOf("\n  uncached-checks:"),
    nightly.indexOf("\n  dashboard:"),
  );

  /** @scenario "A nightly run checks the cache keys against an uncached run for a month" */
  void it("runs typecheck and type-aware lint uncached, on the default branch, until its end date", () => {
    assert.match(job, /NX_SKIP_NX_CACHE: "true"/);
    assert.doesNotMatch(job, /uses: .*nx-remote-cache/);
    assert.match(job, /pnpm typecheck --skip-nx-cache/);
    assert.match(job, /pnpm lint:types/);
    assert.match(job, /github\.ref_name == github\.event\.repository\.default_branch/);
    assert.match(job, /UNCACHED_CHECKS_END: "2026-12-28"/);
    assert.match(job, /::warning::/);
  });
});

void describe("type-aware lint", () => {
  const nx = JSON.parse(readFileSync(join(workspaceRoot, "nx.json"), "utf8"));

  /** @scenario "Type-aware lint batches the projects Nx did not replay" */
  void it("caches lint:types per project with no task dependency, so its misses form one batch", () => {
    assert.equal(nx.targetDefaults["lint:types"].dependsOn, undefined);
    assert.equal(nx.targetDefaults["lint:types"].cache, true);
    assert.ok(nx.targetDefaults["lint:types"].inputs.includes("^production"));
    assert.ok(nx.namedInputs.lintGlobals.includes("{workspaceRoot}/dev/nx/lint.mjs"));
    assert.ok(nx.namedInputs.lintGlobals.includes("{workspaceRoot}/dev/nx/executors/**/*"));
    assert.ok(!targets["lint:tree"].dependsOn.some((task) => task.endsWith("typecheck")));
  });
});
