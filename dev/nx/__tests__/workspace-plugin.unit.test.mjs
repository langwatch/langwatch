import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, matchesGlob } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { typecheckTarget } from "../typecheck-plugin.mjs";
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

void describe("type-aware lint", () => {
  const nx = JSON.parse(readFileSync(join(workspaceRoot, "nx.json"), "utf8"));

  /** @scenario "Type-aware lint batches the projects Nx did not replay" */
  void it("caches lint:types per project with no task dependency, so its misses form one batch", () => {
    assert.equal(nx.targetDefaults["lint:types"].dependsOn, undefined);
    assert.equal(nx.targetDefaults["lint:types"].cache, true);
    assert.ok(nx.targetDefaults["lint:types"].inputs.includes("^production"));
    assert.ok(!targets["lint:tree"].dependsOn.some((task) => task.endsWith("typecheck")));
  });
});
