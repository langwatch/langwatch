// dev/nx/test-reads-plugin.mjs and nx.json, bound to specs/tooling/nx-reruns.feature.
// The lint scenarios bind in tools/lintrun.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { matchesGlob } from "node:path";
import { describe, it } from "node:test";

import { reads } from "../test-reads-plugin.mjs";

const SCANNERS = {
  "@langwatch/time": "packages/time",
  "@langwatch/handled-error": "packages/handled-error",
  "@langwatch/csv": "packages/csv",
  "@langwatch/scenario-contract": "modules/scenario/contract",
  "@langwatch/design-system": "packages/design-system",
  "@langwatch/authz-process": "modules/authz/process",
  "@langwatch/entitlement-process": "modules/entitlement/process",
  "@langwatch/identity-process": "modules/identity/process",
  "@langwatch/workflow-process": "modules/workflow/process",
  "@langwatch/stored-object-process": "modules/stored-object/process",
};
const repoFile = (path) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
const nxJson = JSON.parse(repoFile("nx.json"));
const hashes = ({ name, path }) => (reads[name] ?? []).some((glob) => matchesGlob(path, glob));

void describe("Nx reruns", () => {
  /** @scenario "A repo-scanning suite runs uncached, outside the cached test target" */
  void it("gives each scanner package an uncached test:repo and no source row in reads", () => {
    assert.deepEqual(nxJson.targetDefaults["test:repo"], { cache: false });
    for (const [name, root] of Object.entries(SCANNERS)) {
      const { scripts } = JSON.parse(repoFile(`${root}/package.json`));
      assert.equal(scripts["test:repo"], "vitest run --config vitest.repo.config.ts", name);
      assert.equal(hashes({ name, path: "packages/process/src/server.ts" }), false, name);
      assert.equal(hashes({ name, path: "modules/trace/process/src/server.ts" }), false, name);
    }
  });

  /** @scenario "Tests and Markdown are not part of a package's production input" */
  void it("excludes __tests__ and Markdown from the production input", () => {
    const { production } = nxJson.namedInputs;
    assert.ok(production.includes("!{projectRoot}/**/__tests__/**/*"));
    assert.ok(production.includes("!{projectRoot}/**/*.md"));
  });
});
