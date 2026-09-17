#!/usr/bin/env node
// Apply only in the root cutover: remove obsolete install declarations, retain other exports.
import { existsSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { inventory, ts, nodes, name, edits, read, root, parse } from "./browser-supply-tree.mjs";

export function cleanupPlan() {
  const tree = inventory();
  const output = new Map();
  const files = [
    ...new Set(tree.installations.map((entry) => entry.file)),
    "apps/ui/src/features/annotation/index.ts",
  ];
  let declarations = 0;
  for (const file of files) {
    const source = tree.sources.get(file);
    const removed = source.statements.filter(
      (statement) =>
        ts.isVariableStatement(statement) &&
        statement.declarationList.declarations.some(
          (entry) =>
            tree.installations.some(
              (item) => item.file === file && item.symbol === name(entry.name),
            ) || name(entry.name) === "annotationWeb",
        ),
    );
    declarations += removed.reduce(
      (count, statement) => count + statement.declarationList.declarations.length,
      0,
    );
    let text = edits(
      source.text,
      removed.map((statement) => ({
        start: statement.getFullStart(),
        end: statement.end,
        text: "",
      })),
    );
    text = removeInstallResidue(file, text);
    output.set(file, parse(file, text).statements.length ? `${text.trim()}\n` : null);
  }
  return { output, declarations };
}
if (process.argv[1] === import.meta.filename) {
  const plan = cleanupPlan();
  const removed = [...plan.output.values()].filter((source) => source === null).length;
  if (process.argv.includes("--write")) {
    const chain = read("apps/ui/src/features/installed-ui-features.ts");
    if (!chain.includes(".withModules("))
      throw new Error("Root must use declared composition before cleanup");
    const legacy = ["collectWebInstallations", "installUiFeatures"].some((name) =>
      chain.includes(name),
    );
    if (legacy) throw new Error("Root must use declared composition before cleanup");
    for (const [file, source] of plan.output) {
      if (source === null) {
        if (existsSync(resolve(root, file))) unlinkSync(resolve(root, file));
      } else writeFileSync(resolve(root, file), source);
    }
  }
  console.log(
    `${process.argv.includes("--write") ? "removed" : "would remove"} ${plan.declarations} old install declarations across ${plan.output.size} feature entries`,
  );
  console.log(
    `${removed} empty entries deleted; ${plan.output.size - removed} entries retain independent exports; host adapters stay as named renderer supply`,
  );
  console.log(
    "prerequisite: root cutover and its tests; never run this alongside the old installed-ui-features list",
  );
}

function removeInstallResidue(file, text) {
  const current = parse(file, text);
  const aggregate = current.statements.filter(
    (statement) =>
      ts.isVariableStatement(statement) &&
      !statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword),
  );
  for (const statement of aggregate) {
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isObjectLiteralExpression(declaration.initializer))
        throw new Error(`Review non-literal residue in ${file}`);
      if (!declaration.initializer.properties.every(ts.isSpreadAssignment))
        throw new Error(`Review non-aggregate residue in ${file}`);
    }
  }
  text = edits(
    text,
    aggregate.map((statement) => ({
      start: statement.getFullStart(),
      end: statement.end,
      text: "",
    })),
  );
  return pruneImports(file, text);
}
function pruneImports(file, text) {
  const current = parse(file, text);
  const body = current.statements.filter((statement) => !ts.isImportDeclaration(statement));
  const used = new Set(
    body.flatMap((statement) => nodes(statement, ts.isIdentifier).map((node) => node.text)),
  );
  const changes = [];
  for (const statement of current.statements.filter(ts.isImportDeclaration)) {
    const bindings = statement.importClause?.namedBindings;
    if (!bindings) continue;
    if (!ts.isNamedImports(bindings)) continue;
    const retained = bindings.elements.filter((element) => used.has(name(element.name)));
    if (retained.length === bindings.elements.length) continue;
    const type = statement.importClause.isTypeOnly ? "type " : "";
    const bindingSource = retained.map((element) => element.getText(current)).join(", ");
    changes.push({
      start: statement.getFullStart(),
      end: statement.end,
      text: retained.length
        ? `\nimport ${type}{ ${bindingSource} } from ${JSON.stringify(statement.moduleSpecifier.text)};`
        : "",
    });
  }
  return edits(text, changes);
}
