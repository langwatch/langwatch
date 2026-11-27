import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { createNodes } from "../workspace-plugin.mjs";

const workspaceRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const [, create] = createNodes;
const [[, { projects }]] = create(["nx.json"], {}, { workspaceRoot });
const { targets } = projects["dev/nx"];

void describe("workspace targets", () => {
  /** @scenario "The root typecheck and the lint runs replay from the cache" */
  void it("caches the root typecheck and the lint runs", () => {
    assert.equal(targets.typecheck.cache, true);
    assert.equal(targets["typecheck:src"].cache, true);
    assert.equal(targets["lint:tree"].cache, true);
  });

  /** @scenario "The root typecheck and the lint runs replay from the cache" */
  void it("hashes the sources of what tsc reads and of the files its dependencies generate", () => {
    const { inputs, dependsOn } = targets.typecheck;
    assert.ok(inputs.includes("{workspaceRoot}/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs,json}"));
    assert.ok(inputs.includes("{workspaceRoot}/**/*.prisma"));
    assert.ok(inputs.includes("{workspaceRoot}/sdks/typescript/copy-types.sh"));
    assert.ok(inputs.every((input) => input.dependentTasksOutputFiles === undefined));
    assert.ok(dependsOn.includes("@langwatch/prisma-client:prisma:generate"));
  });

  /** @scenario "The root typecheck and the lint runs replay from the cache" */
  void it("declares the declarations typecheck writes as globs, never a dist directory", () => {
    const { outputs } = targets.typecheck;
    assert.ok(outputs.includes("{workspaceRoot}/packages/time/dist/**/*.d.ts"));
    assert.ok(outputs.includes("{workspaceRoot}/packages/ksuid/dist/**/*.tsbuildinfo"));
    assert.ok(!outputs.includes("{workspaceRoot}/packages/ksuid/dist/**/*.d.ts"));
    assert.ok(outputs.includes("{workspaceRoot}/packages/mail/dist/typecheck/**/*.d.ts"));
    assert.ok(outputs.every((output) => !output.endsWith("/dist")));
  });

  /** @scenario "Type-aware lint reads declarations typecheck built from hashed sources" */
  void it("runs the type-aware lint after typecheck and the plain lint without it", () => {
    assert.ok(targets["lint:tree:types"].dependsOn.includes("typecheck"));
    assert.ok(!targets["lint:tree"].dependsOn.includes("typecheck"));
    assert.equal(targets["lint:tree:types"].cache, true);
  });

  /** @scenario "Build info written outside dist is a typecheck output" */
  void it("declares build info a config writes outside its dist", () => {
    const { outputs } = targets.typecheck;
    assert.ok(outputs.includes("{workspaceRoot}/apps/docs/.tsbuild/tsconfig.tsbuildinfo"));
  });
});
