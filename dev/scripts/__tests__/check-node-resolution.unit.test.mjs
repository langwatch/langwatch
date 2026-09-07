// Unit tests for check-node-resolution.mjs's classifier
// (specs/tooling/node-resolution-check.feature). Each case spawns a real
// node against a small fixture tree under a temp directory, exactly the way
// the real check spawns node against a barrel — no mocking of node's
// resolver, since the whole point of the guard is what the real resolver
// does that TypeScript's does not.
//
//   node --test dev/scripts/__tests__/check-node-resolution.unit.test.mjs

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import {
  checkTarget,
  isBrowserSkipPath,
  parseModuleNotFound,
  root,
} from "../check-node-resolution.mjs";

// checkTarget joins its argument onto the script's own repo root, so the
// fixtures live under a temp directory *inside* the repo tree rather than in
// the system temp dir. It must not be under node_modules: node refuses type
// stripping there unconditionally, which is not the defect this test is
// about.
const fixtureRoot = mkdtempSync(
  join(root, "dev/scripts/__tests__", ".check-node-resolution-fixture-"),
);
const fixtureRel = (...parts) => join(...parts).replace(root + "/", "");

after(() => {
  rmSync(fixtureRoot, { recursive: true, force: true });
});

function write(relPathFromFixture, contents) {
  const abs = join(fixtureRoot, relPathFromFixture);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, contents);
  return abs;
}

describe("given a barrel that re-exports a sibling module by its exact file name", () => {
  write("good/constants.ts", "export const A = 1;\n");
  const barrel = write("good/index.ts", 'export * from "./constants.ts";\n');
  const relTarget = fixtureRel(barrel);

  /** @scenario "A barrel whose specifiers carry their on-disk extension resolves" */
  it("is reported ok", async () => {
    const result = await checkTarget(relTarget);
    assert.equal(result.status, "ok");
  });
});

describe("given a barrel that re-exports a sibling module without its file extension", () => {
  write("bad/constants.ts", "export const A = 1;\n");
  const barrel = write("bad/index.ts", 'export * from "./constants";\n');
  const relTarget = fixtureRel(barrel);

  /** @scenario "An extensionless relative specifier fails resolution and names the file and specifier" */
  it("is reported as a resolution failure naming the specifier and the importing file", async () => {
    const result = await checkTarget(relTarget);
    assert.equal(result.status, "failed");
    assert.equal(result.code, "ERR_MODULE_NOT_FOUND");
    assert.ok(result.specifier?.endsWith("/bad/constants"), result.specifier);
    assert.ok(result.importer?.endsWith("/bad/index.ts"), result.importer);
  });
});

describe("given a barrel under a browser-package path that re-exports a sibling .tsx module", () => {
  write("packages/some-feature/web/src/component.tsx", "export const X = 1;\n");
  const barrel = write(
    "packages/some-feature/web/src/index.ts",
    'export * from "./component.tsx";\n',
  );
  const relTarget = fixtureRel(barrel);

  it("the fixture path itself matches the browser-package predicate", () => {
    assert.equal(isBrowserSkipPath(relTarget), true);
  });

  /** @scenario "A missing .tsx extension is expected for a browser package and is not a failure" */
  it("is reported as skipped, not failed", async () => {
    const result = await checkTarget(relTarget);
    assert.equal(result.status, "skipped");
    assert.equal(result.code, "ERR_UNKNOWN_FILE_EXTENSION");
  });
});

describe("given an ERR_MODULE_NOT_FOUND message", () => {
  it("parses the specifier and the importing file out of the message text", () => {
    const parsed = parseModuleNotFound(
      "Cannot find module '/repo/packages/foo/src/constants' imported from /repo/packages/foo/src/index.ts",
    );
    assert.deepEqual(parsed, {
      specifier: "/repo/packages/foo/src/constants",
      importer: "/repo/packages/foo/src/index.ts",
    });
  });

  it("returns null for a message it does not recognize", () => {
    assert.equal(parseModuleNotFound("something else entirely"), null);
  });
});
