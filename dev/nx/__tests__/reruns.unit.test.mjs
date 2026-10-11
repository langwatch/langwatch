// dev/nx/lint.mjs, dev/nx/test-reads-plugin.mjs and nx.json,
// bound to specs/tooling/nx-reruns.feature.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { matchesGlob } from "node:path";
import { describe, it } from "node:test";

import { plainScope } from "../lint.mjs";
import { reads } from "../test-reads-plugin.mjs";

const SCANNERS = [
  "@langwatch/time",
  "@langwatch/handled-error",
  "@langwatch/csv",
  "@langwatch/scenario-contract",
];
const hashes = ({ name, path }) => reads[name].some((glob) => matchesGlob(path, glob));

void describe("Nx reruns", () => {
  /** @scenario "A repo-scanning suite hashes only the TypeScript its walk reads" */
  void it("keeps the scanners' cache warm across non-TypeScript edits", () => {
    for (const name of SCANNERS) {
      for (const path of ["packages/time/README.md", "modules/catalogue.json", "services/x/a.go"]) {
        assert.equal(hashes({ name, path }), false, `${name} hashes ${path}`);
      }
      assert.equal(hashes({ name, path: "packages/process/src/server.ts" }), true, name);
    }
  });

  /** @scenario "Tests and Markdown are not part of a package's production input" */
  void it("excludes __tests__ and Markdown from the production input", () => {
    const { production } = JSON.parse(
      readFileSync(new URL("../../../nx.json", import.meta.url)),
    ).namedInputs;
    assert.ok(production.includes("!{projectRoot}/**/__tests__/**/*"));
    assert.ok(production.includes("!{projectRoot}/**/*.md"));
  });

  /** @scenario "A plain lint:changed lints the changed files, not their dependants" */
  void it("lints only the changed lintable files", () => {
    const files = ["dev/nx/lint.mjs", "packages/time/README.md", "packages/time/src/gone.ts"];
    assert.deepEqual(plainScope({ files, globals: ["modules/catalogue.json"] }), [
      "dev/nx/lint.mjs",
    ]);
  });

  /** @scenario "A changed lint global relints the whole tree" */
  void it("lints the tree when a lint global changed", () => {
    const files = ["dev/nx/lint.mjs", ".oxlintrc.native.jsonc"];
    assert.deepEqual(plainScope({ files, globals: [".oxlintrc.*.jsonc"] }), ["."]);
  });
});
