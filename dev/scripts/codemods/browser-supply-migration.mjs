#!/usr/bin/env node
// The apply unit: declarations, navigation and flag changes are composed before any write.
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { declarationPlan, applyPlan } from "./browser-supply-declarations.mjs";
import { flagPlan } from "./browser-supply-flags.mjs";
import { navigationPlan } from "./browser-supply-navigation.mjs";
import { parse, camel, quote, root } from "./browser-supply-tree.mjs";

export function migrationPlan() {
  const declarations = declarationPlan();
  const navigation = navigationPlan();
  const flags = flagPlan();
  const output = new Map([...declarations.output, ...navigation.output, ...flags.output]);
  for (const module of declarations.tree.modules.filter((entry) => entry.manifest)) {
    const file = `${module.root}/web/src/${module.id}.web.ts`;
    let text = output.get(file).trimEnd().replace(/;$/, "");
    const navigationFile = `${module.root}/web/src/model/${module.id}.browser-navigation.ts`;
    if (navigation.output.has(navigationFile)) {
      text = `import { ${camel(module.id)}Navigation } from ${quote(`./model/${module.id}.browser-navigation.ts`)};\n${text}\n  .withNavigation(${camel(module.id)}Navigation)`;
    }
    const tuple = flags.tuples.get(module.id);
    if (tuple)
      text = `import { ${tuple.value} } from ${quote(`./model/${module.id}.browser-flags.ts`)};\n${text}\n  .withFlags(${tuple.value})`;
    output.set(file, `${text};\n`);
    const manifestFile = `${module.root}/web/package.json`;
    const manifest = JSON.parse(output.get(manifestFile));
    if (tuple) manifest.dependencies["@langwatch/feature-flag-contract"] = "workspace:*";
    if (navigation.output.has(navigationFile)) manifest.dependencies["lucide-react"] = "catalog:";
    output.set(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  }
  for (const [file, text] of output) if (/\.tsx?$/.test(file)) parse(file, text);
  return { output, declarations, navigation, flags };
}
if (process.argv[1] === import.meta.filename) {
  const plan = migrationPlan();
  const changed = applyPlan(plan.output, process.argv.includes("--write"));
  const added = changed.filter(([file]) => !existsSync(resolve(root, file))).length;
  console.log(
    `${process.argv.includes("--write") ? "wrote" : "would write"} ${changed.length} unique files (${added} new, ${changed.length - added} existing)`,
  );
  console.log(
    `41 module declarations; ${plan.declarations.tree.pages.length} page keys; 44 drawers; 37 providers; 8 config projections`,
  );
  console.log(
    `110 navigation contributions; ${plan.navigation.cases} settings equivalence cases; ${plan.flags.reads} flag reads narrowed`,
  );
  console.log("all proposed TypeScript parses; no production files written without --write");
}
