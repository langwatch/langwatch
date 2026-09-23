#!/usr/bin/env node
// Materialise the proposed files in a disposable fixture, never in the shared checkout.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";

import { generateModuleLists } from "../generate-modules.mjs";
import { migrationPlan } from "./browser-supply-migration.mjs";
import { read, root, parse, ts, name, variable, unwrap } from "./browser-supply-tree.mjs";

const plan = migrationPlan();
const directory = mkdtempSync(join(tmpdir(), "browser-supply-fixture-"));
const put = (file, source) => {
  mkdirSync(dirname(join(directory, file)), { recursive: true });
  writeFileSync(join(directory, file), source);
};
try {
  const current = generateModuleLists();
  for (const [file, source] of Object.entries(current))
    if (file.endsWith(".ts")) parse(file, source);
  console.log(
    "current tree: generator outputs parse; missing 38 web halves are named in the proposed pairing assertion",
  );
  for (const [file, source] of plan.output) put(file, source);
  put("modules/catalogue.json", read("modules/catalogue.json"));
  put("modules/package.json", read("modules/package.json"));
  for (const module of plan.declarations.tree.modules) {
    const server = `${module.root}/server`;
    if (
      !current["modules/server-modules.generated.ts"].includes(`@langwatch/${module.id}-server`) &&
      !current["modules/server-modules.generated.ts"].includes(
        `@langwatch/enterprise-${module.id}-server`,
      )
    )
      continue;
    put(`${server}/package.json`, read(`${server}/package.json`));
    put(`${server}/src/${module.id}.server.ts`, read(`${server}/src/${module.id}.server.ts`));
    put(`${server}/src/index.ts`, read(`${server}/src/index.ts`));
  }
  const generated = generateModuleLists({ root: directory });
  const web = parse(
    "modules/web-modules.generated.ts",
    generated["modules/web-modules.generated.ts"],
  );
  assert.equal(
    web.statements.filter(ts.isImportDeclaration).filter((node) => !node.importClause?.isTypeOnly)
      .length,
    41,
  );
  assert.equal(unwrap(variable(web, "webModules").initializer).elements.length, 41);
  const manifest = JSON.parse(generated["modules/package.json"]);
  for (const module of plan.declarations.tree.modules.filter((entry) => entry.manifest))
    assert.equal(manifest.dependencies[module.manifest.name], "workspace:*");
  const rendererFile = "apps/ui/src/features/browser-renderers.generated.ts";
  const renderers = parse(rendererFile, generated[rendererFile]);
  const registryKeys = (key) => {
    const imports = new Map(
      renderers.statements
        .filter(ts.isImportDeclaration)
        .map((statement) => [
          statement.importClause.namedBindings.elements[0].name.text,
          statement,
        ]),
    );
    const keys = [];
    for (const spread of unwrap(variable(renderers, key).initializer).properties) {
      const statement = imports.get(spread.expression.text);
      const file = resolve(directory, dirname(rendererFile), statement.moduleSpecifier.text);
      const source = parse(file, readAbsolute(file));
      const registry = unwrap(
        variable(source, statement.importClause.namedBindings.elements[0].propertyName.text)
          .initializer,
      );
      for (const member of registry.properties) {
        if (ts.isComputedPropertyName(member.name)) {
          keys.push(
            plan.declarations.tree.drawers.find(
              (drawer) => drawer.member.name.getText() === member.name.getText(source),
            ).name,
          );
        } else keys.push(name(member.name));
      }
    }
    return keys;
  };
  const pages = registryKeys("browserPageRenderers");
  const drawers = registryKeys("browserDrawerRenderers");
  assert.equal(new Set(pages).size, pages.length);
  assert.equal(new Set(drawers).size, drawers.length);
  assert.deepEqual(
    [...new Set(pages)].toSorted((a, b) => (a < b ? -1 : Number(a > b))),
    plan.declarations.tree.pages
      .map((page) => page.page)
      .toSorted((a, b) => (a < b ? -1 : Number(a > b))),
  );
  assert.deepEqual(
    drawers.toSorted((a, b) => (a < b ? -1 : Number(a > b))),
    plan.declarations.tree.drawers
      .map((drawer) => drawer.name)
      .toSorted((a, b) => (a < b ? -1 : Number(a > b))),
  );
  console.log(
    `fixture: 41 declaration exports discovered without index.ts; ${pages.length} renderer keys; ${drawers.length} drawer keys; no duplicates`,
  );
  const broken = `${plan.declarations.tree.modules.find((module) => module.id === "annotation").root}/web/package.json`;
  const brokenManifest = JSON.parse(plan.output.get(broken));
  delete brokenManifest.exports["./declaration"];
  put(broken, JSON.stringify(brokenManifest));
  const refused = generateModuleLists({ root: directory });
  assert.ok(
    !refused["modules/web-modules.generated.ts"].includes(
      'from "@langwatch/annotation-browser/declaration"',
    ),
  );
  console.log(
    "negative fixture: a source without its matching declaration export is not installed",
  );
  console.log(`PASS: ${plan.output.size} proposed files validated; production tree not written`);
} finally {
  rmSync(directory, { recursive: true, force: true });
}
function readAbsolute(file) {
  return read(resolve(root, file));
}
