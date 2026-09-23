#!/usr/bin/env node
// Keep each reader's behaviour and narrow its key at the call, including host-backed readers.
import { relative, dirname } from "node:path";

import { applyPlan } from "./browser-supply-declarations.mjs";
import {
  inventory,
  files,
  parse,
  ts,
  nodes,
  name,
  unwrap,
  variable,
  edits,
  camel,
  quote,
} from "./browser-supply-tree.mjs";

export function flagPlan() {
  const tree = inventory();
  const output = new Map();
  const tuples = new Map();
  const registeredSource = parse("modules/feature-flag/contract/src/frontend-feature-flags.ts");
  const registered = new Set(
    unwrap(variable(registeredSource, "FRONTEND_FEATURE_FLAGS").initializer).elements.map(name),
  );
  const counts = { reads: 0, dynamic: 0 };
  eachFlagModule(tree, output, tuples, registered, counts);
  const used = new Set([...tuples.values()].flatMap((tuple) => tuple.flags));
  return {
    output,
    tuples,
    ...counts,
    unread: [...registered].filter((flag) => !used.has(flag)),
  };
}
if (process.argv[1] === import.meta.filename) {
  const plan = flagPlan();
  const changed = applyPlan(plan.output, process.argv.includes("--write"));
  for (const [id, tuple] of plan.tuples) console.log(`${id}: ${tuple.flags.length} declared flags`);
  console.log(
    `${process.argv.includes("--write") ? "wrote" : "would write"} ${changed.length} files: ${plan.tuples.size} flag tuples; ${changed.length - plan.tuples.size} reader/host files; ${plan.reads} reads (${plan.dynamic} non-literal arguments retained and type-checked)`,
  );
  console.log(`unread in web packages: ${plan.unread.join(", ") || "none"}`);
}

function eachFlagModule(tree, output, tuples, registered, counts) {
  for (const module of tree.modules.filter((entry) => entry.manifest)) {
    rewriteFlagModule(output, tuples, registered, counts, module);
  }
}
function rewriteFlagSource(source, declaration, type, output, counts) {
  const changes = [];
  for (const node of nodes(source, ts.isCallExpression)) {
    const expression = node.expression.getText(source);
    if (!/(?:^useFeatureFlag|\.featureFlag)$/.test(expression)) continue;
    const argument = node.arguments[0];
    if (!argument || ts.isSatisfiesExpression(argument)) continue;
    changes.push({
      start: argument.getStart(source),
      end: argument.end,
      text: `(${argument.getText(source)} satisfies ${type})`,
    });
    counts.reads++;
    if (!ts.isStringLiteral(argument)) counts.dynamic++;
  }
  rewriteFlagParameters(source, type, changes);
  if (!changes.length) return;
  let specifier = relative(dirname(source.fileName), declaration);
  if (!specifier.startsWith(".")) specifier = `./${specifier}`;
  const text = `import type { ${type} } from ${quote(specifier)};\n${edits(source.text, changes)}`;
  parse(source.fileName, text);
  output.set(source.fileName, text);
}

function rewriteFlagParameters(source, type, changes) {
  for (const node of nodes(source, ts.isParameter)) {
    if (name(node.name) !== "flag") continue;
    if (!node.type) continue;
    if (!["string", "FrontendFeatureFlag"].includes(node.type.getText(source))) continue;
    const parentName = name(node.parent.name);
    if (!["useFeatureFlag", "featureFlag"].includes(parentName)) continue;
    changes.push({ start: node.type.getStart(source), end: node.type.end, text: type });
  }
}

function rewriteFlagModule(output, tuples, registered, counts, module) {
  const sourceFiles = files(`${module.root}/web/src`).filter(
    (file) => /\.tsx?$/.test(file) && !/(?:__tests__|testing\.|\.test\.|browser-flags)/.test(file),
  );
  const sources = sourceFiles.map((file) => parse(file));
  const flags = new Set();
  for (const source of sources)
    for (const node of nodes(source, ts.isStringLiteral))
      if (registered.has(node.text)) flags.add(node.text);
  if (!flags.size) return;
  const declaration = `${module.root}/web/src/model/${module.id}.browser-flags.ts`;
  const value = `${camel(module.id)}WebFlags`;
  const type = `${camel(module.id)[0].toUpperCase()}${camel(module.id).slice(1)}WebFlag`;
  output.set(
    declaration,
    `import type { FrontendFeatureFlag } from "@langwatch/feature-flag-contract";\nexport const ${value} = ${JSON.stringify([...flags].toSorted((a, b) => (a < b ? -1 : Number(a > b))))} as const satisfies readonly FrontendFeatureFlag[];\nexport type ${type} = (typeof ${value})[number];\n`,
  );
  tuples.set(module.id, { file: declaration, value, type, flags: [...flags] });
  for (const source of sources) {
    rewriteFlagSource(source, declaration, type, output, counts);
  }
}
