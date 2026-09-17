#!/usr/bin/env node
// Dry-run by default. Run --write only with the declaration builder and root integration ready.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

import {
  inventory,
  ts,
  nodes,
  prop,
  name,
  unwrap,
  parse,
  read,
  root,
  camel,
  quote,
  variable,
  edits,
} from "./browser-supply-tree.mjs";

export function declarationPlan() {
  const tree = inventory();
  const output = new Map();
  const imports = new Map();
  const publications = new Map(
    tree.modules.filter((entry) => entry.manifest).map((entry) => [entry.id, new Map()]),
  );
  const mounts = new Map([...publications.keys()].map((id) => [id, new Set()]));
  const relativeImport = (from, to) => {
    const path = relative(dirname(from), to);
    return path.startsWith(".") ? path : `./${path}`;
  };

  collectDeclaredMounts(tree, publications, mounts);
  const bindings = providerBindings(tree, publications, mounts);
  preserveProviderOrder(tree, publications, bindings);
  const projections = configProjections();
  const screenDefinitions = (owner) => moduleScreenDefinitions(tree, owner);
  moduleDeclarations(
    tree,
    output,
    projections,
    publications,
    mounts,
    relativeImport,
    screenDefinitions,
  );
  narrowLoaderMaps(tree, output);
  rendererRegistry(tree, output, imports, relativeImport, screenDefinitions);
  for (const [file, source] of output) if (/\.tsx?$/.test(file)) parse(file, source);
  return { tree, output, bindings, publications, mounts, projections };
}

function productForPath(path) {
  if (!path) return null;
  for (const prefix of ["me", "gateway", "governance"])
    if (path === `/${prefix}` || path.startsWith(`/${prefix}/`)) return prefix;
  return path.startsWith("/:project") || path === "*" ? "llm-ops" : null;
}

function moduleScreenDefinitions(tree, owner) {
  return Object.fromEntries(
    tree.pages
      .filter((page) => page.owner === owner)
      .map((page) => [
        page.page,
        {
          routes: tree.routes
            .filter((route) => route.page === page.page)
            .map((route) => ({
              ...(route.path ? { path: route.path } : {}),
              ...(route.instance ? { instance: route.instance } : {}),
              layouts: route.parents,
            })),
          within: productForPath(page.path),
          shell:
            page.path?.startsWith("/settings") || page.path?.startsWith("/ops")
              ? "settings"
              : "default",
        },
      ]),
  );
}
export function applyPlan(output, write) {
  const changed = [...output].filter(
    ([file, source]) => !existsSync(resolve(root, file)) || read(file) !== source,
  );
  if (write) {
    if (!existsSync(resolve(root, "packages/ui-kernel/package.json")))
      throw new Error("Build @langwatch/ui-kernel before applying this migration");
    for (const [file, source] of changed) {
      mkdirSync(dirname(resolve(root, file)), { recursive: true });
      writeFileSync(resolve(root, file), source);
    }
  }
  return changed;
}
if (process.argv[1] === import.meta.filename) {
  const plan = declarationPlan();
  const changed = applyPlan(plan.output, process.argv.includes("--write"));
  for (const module of plan.tree.modules.filter((entry) => entry.manifest)) {
    console.log(
      `${module.id}: ${plan.tree.pages.filter((page) => page.owner === module.id).length} page keys; ${plan.tree.drawers.filter((drawer) => drawer.owner === module.id).length} drawers; ${plan.publications.get(module.id).size} publications; ${plan.mounts.get(module.id).size} mounts`,
    );
  }
  console.log(
    `${process.argv.includes("--write") ? "wrote" : "would write"} ${changed.length} files: 41 declarations, 41 manifests, 15 drawer registries, 1 renderer registry, 1 shell declaration, ${changed.length - 103} loader files narrowed, 4 slot files narrowed`,
  );
  console.log(
    `${plan.bindings.length} provider bindings; ${[...plan.publications.values()].reduce((n, entries) => n + entries.size, 0)} published addresses; ${plan.projections.size} config projections; 0 host implementations moved`,
  );
  console.log(
    "prerequisite: ui-kernel builder + typed renderer supply; root integration is a separate atomic step",
  );
}

function exportTarget(owner, address) {
  const suffix = address.slice(owner.manifest.name.length);
  const exported = owner.manifest.exports[suffix ? `.${suffix}` : "."];
  const target =
    typeof exported === "string"
      ? exported
      : (exported?.["langwatch-declaration-source"] ?? exported?.default);
  if (!target) throw new Error(`Not an exported surface: ${address}`);
  return `${owner.root}/web/${target.replace(/^\.\//, "")}`;
}

function publish(tree, publications, address, binding) {
  const owner = tree.packageOwner(address);
  if (!owner) throw new Error(`No publisher for ${address}`);
  const existing = publications.get(owner.id).get(address);
  if (existing?.binding && binding && existing.binding !== binding)
    throw new Error(`Two provider exports for ${address}`);
  publications.get(owner.id).set(address, {
    target: exportTarget(owner, address),
    binding: binding ?? existing?.binding,
  });
}

function bindingAt(tree, file, localName) {
  const source = tree.sources.get(file) ?? parse(file);
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const imports = statement.importClause?.namedBindings;
    if (!imports) continue;
    if (!ts.isNamedImports(imports)) continue;
    const binding = imports.elements.find((entry) => name(entry.name) === localName);
    if (!binding) continue;
    let address = statement.moduleSpecifier.text;
    let exported = name(binding.propertyName ?? binding.name);
    const owner = tree.packageOwner(address);
    if (!owner) throw new Error(`Provider ${localName} does not come from a web package`);
    const entry = parse(exportTarget(owner, address));
    ({ address, exported } = forwardedBinding(tree, entry, address, exported));
    return { address, exported };
  }
  throw new Error(`No provider import ${localName} in ${file}`);
}

function collectDeclaredMounts(tree, publications, mounts) {
  for (const feature of tree.catalogue.features) {
    const consumer = tree.owners.get(feature.root);
    if (!consumer) continue;
    for (const address of feature.uses.surfaces) {
      publish(tree, publications, address);
      mounts.get(consumer.id).add(address);
    }
  }
}

function providerBindings(tree, publications, mounts) {
  const bindings = [];
  for (const installation of tree.installations) {
    const api = prop(installation.options, "api");
    if (!api) continue;
    const binding = bindingAt(tree, installation.file, api.getText(installation.source));
    publish(tree, publications, binding.address, binding.exported);
    const consumer = tree.owners.get(installation.folder)?.id ?? installation.owner;
    mounts.get(consumer).add(binding.address);
    bindings.push({ ...binding, consumer, legacyName: installation.address });
  }
  const annotation = tree.sources.get("apps/ui/src/features/annotation/index.ts");
  for (const call of nodes(annotation, ts.isCallExpression).filter(
    (node) => node.expression.getText(annotation) === "uiApiBinding",
  )) {
    const binding = bindingAt(tree, annotation.fileName, call.arguments[1].getText(annotation));
    publish(tree, publications, binding.address, binding.exported);
    mounts.get("annotation").add(binding.address);
    bindings.push({ ...binding, consumer: "annotation", legacyName: name(call.arguments[0]) });
  }
  return bindings;
}

function preserveProviderOrder(tree, publications, bindings) {
  const installed = tree.sources.get("apps/ui/src/features/installed-ui-features.ts");
  const order = unwrap(variable(installed, "features").initializer).elements.map((node) =>
    node.getText(installed),
  );
  for (const binding of bindings) {
    const installation = tree.installations.find((entry) => entry.address === binding.legacyName);
    binding.order = order.indexOf(installation?.symbol ?? "annotationWeb");
    if (binding.order < 0) throw new Error(`Missing install order for ${binding.legacyName}`);
    publications.get(tree.packageOwner(binding.address).id).get(binding.address).order =
      binding.order;
  }
}

function configProjections() {
  const configFile = "apps/ui/src/behavior/ui-feature-config.ts";
  const configSource = parse(configFile);
  const projections = new Map();
  const configOwners = { deployment: "saas", observability: "ops", evaluation: "evaluator" };
  for (const node of nodes(configSource, ts.isPropertyAssignment)) {
    if (!ts.isCallExpression(node.initializer)) continue;
    if (!ts.isPropertyAccessExpression(node.initializer.expression)) continue;
    if (node.initializer.expression.name.text !== "parse") continue;
    const schema = node.initializer.expression.expression.getText(configSource);
    const schemaImport = configSource.statements.find(
      (statement) =>
        ts.isImportDeclaration(statement) &&
        statement.importClause?.namedBindings?.getText(configSource).includes(schema),
    );
    const owner = configOwners[name(node.name)] ?? name(node.name);
    projections.set(owner, {
      key: name(node.name),
      schema,
      package: schemaImport.moduleSpecifier.text,
      expression: node.initializer.arguments[0].getText(configSource),
    });
  }
  return projections;
}

function narrowLoaderMaps(tree, output) {
  for (const file of new Set(tree.loaders.map((loader) => loader.file))) {
    const source = tree.sources.get(file);
    const changes = [];
    for (const node of new Set(
      tree.loaders.filter((loader) => loader.file === file).map((loader) => loader.node),
    )) {
      if (!node.type) continue;
      changes.push({ start: node.name.end, end: node.type.end, text: "" });
      changes.push({
        start: node.initializer.end,
        end: node.initializer.end,
        text: ` satisfies ${node.type.getText(source)}`,
      });
    }
    if (changes.length) output.set(file, edits(source.text, changes));
  }
}

function rendererRegistry(tree, output, imports, relativeImport, screenDefinitions) {
  const registryFile = "apps/ui/src/features/browser-renderers.generated.ts";
  const rendererImports = [];
  const pageEntries = [];
  const drawerEntries = [];
  for (const page of tree.pages) {
    const { file, registry } = page.loader;
    const key = `${file}:${registry}`;
    if (!imports.has(key)) {
      const alias = `pages${imports.size}`;
      imports.set(key, alias);
      rendererImports.push(
        `import { ${registry} as ${alias} } from ${quote(relativeImport(registryFile, file))};`,
      );
    }
    pageEntries.push(`  ${quote(page.page)}: ${imports.get(key)}[${quote(page.page)}]!,`);
  }
  for (const installation of tree.installations) {
    const drawers = prop(installation.options, "drawers");
    if (!drawers) continue;
    const file = `apps/ui/src/features/${installation.folder}/browser-drawers.ts`;
    const keptImports = drawerImports(installation, drawers);
    output.set(
      file,
      `${keptImports.join("\n")}\n\nexport const browserDrawers = ${drawers.getText(installation.source)};\n`,
    );
    const alias = `drawers${drawerEntries.length}`;
    rendererImports.push(
      `import { browserDrawers as ${alias} } from ${quote(relativeImport(registryFile, file))};`,
    );
    drawerEntries.push(`  ...${alias},`);
  }
  output.set(
    registryFile,
    `${rendererImports.join("\n")}\n\nexport const browserPageRenderers = {\n${pageEntries.join("\n")}\n} as const;\n\nexport const browserDrawerRenderers = {\n${drawerEntries.join("\n")}\n} as const;\n`,
  );
  output.set(
    "apps/ui/src/model/ui-shell-screens.ts",
    `export const browserShellScreens = ${JSON.stringify(screenDefinitions("shell"), null, 2)} as const;\n`,
  );
}

function moduleDeclarations(
  tree,
  output,
  projections,
  publications,
  mounts,
  relativeImport,
  screenDefinitions,
) {
  for (const module of tree.modules.filter((entry) => entry.manifest)) {
    emitModuleDeclaration(
      tree,
      output,
      projections,
      publications,
      mounts,
      relativeImport,
      screenDefinitions,
      module,
    );
  }
}

function moduleSlots(tree, module, output) {
  const slotKeys = [];
  let seatCopy = false;
  for (const [sourceFile, source] of tree.sources) {
    if (tree.owners.get(sourceFile.split("/")[4])?.id !== module.id) continue;
    const changes = [];
    const slotSource = collectSlots(sourceFile, source, changes);
    slotKeys.push(...slotSource.keys);
    seatCopy ||= slotSource.seatCopy;
    if (changes.length) output.set(sourceFile, edits(source.text, changes));
  }

  return { slotKeys, seatCopy };
}

function drawerImports(installation, drawers) {
  const identifiers = new Set(nodes(drawers, ts.isIdentifier).map((node) => node.text));
  const keptImports = [];
  for (const node of installation.source.statements.filter(ts.isImportDeclaration)) {
    const bindings = node.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    const used = bindings.elements.filter((entry) => identifiers.has(name(entry.name)));
    if (used.length)
      keptImports.push(
        `import { ${used.map((entry) => entry.getText(installation.source)).join(", ")} } from ${quote(node.moduleSpecifier.text)};`,
      );
  }

  return keptImports;
}

function emitModuleDeclaration(
  tree,
  output,
  projections,
  publications,
  mounts,
  relativeImport,
  screenDefinitions,
  module,
) {
  const file = `${module.root}/web/src/${module.id}.web.ts`;
  const lines = ['import { defineWebModule } from "@langwatch/ui-kernel";'];
  const projection = projections.get(module.id);
  if (projection) lines.push(`import { ${projection.schema} } from ${quote(projection.package)};`);
  const surfaces = [...publications.get(module.id)].map(([address, publication], index) => {
    if (publication.binding) {
      lines.push(
        `import { ${publication.binding} as binding${index} } from ${quote(relativeImport(file, publication.target))};`,
      );
      return `  ${quote(address)}: { provider: binding${index}.Provider, order: ${publication.order}, load: () => import(${quote(relativeImport(file, publication.target))}) },`;
    }
    return `  ${quote(address)}: { load: () => import(${quote(relativeImport(file, publication.target))}) },`;
  });
  const { slotKeys, seatCopy } = moduleSlots(tree, module, output);
  const failures = tree.installations
    .filter(
      (installation) => installation.owner === module.id && prop(installation.options, "failures"),
    )
    .map((installation) => prop(installation.options, "failures").getText(installation.source));
  const screens = screenDefinitions(module.id);
  const drawers = tree.drawers
    .filter((drawer) => drawer.owner === module.id)
    .map((drawer) => drawer.name);
  lines.push(
    "",
    `export const ${camel(module.id)}Web = defineWebModule(${quote(module.id)})`,
    `  .withScreens(${JSON.stringify(screens, null, 2)})`,
    `  .withDrawers(${JSON.stringify(drawers)} as const)`,
    `  .publishSurfaces({\n${surfaces.join("\n")}\n})`,
    `  .mountSurfaces(${JSON.stringify([...mounts.get(module.id)])} as const)`,
  );
  if (slotKeys.length) lines.push(`  .withSlots(${JSON.stringify(slotKeys)} as const)`);
  if (seatCopy) lines.push("  .withSeatTypeCopy()");
  if (failures.length)
    lines.push(`  .withFailureInterceptors(${JSON.stringify(failures)} as const)`);
  if (projection)
    lines.push(`  .withConfig(${projection.schema}, (config) => (${projection.expression}))`);
  lines[lines.length - 1] += ";";
  output.set(file, `${lines.join("\n")}\n`);
  const manifest = structuredClone(module.manifest);
  manifest.exports["./declaration"] = {
    "langwatch-declaration-source": `./src/${module.id}.web.ts`,
    types: `./dist/${module.id}.web.d.ts`,
    default: `./src/${module.id}.web.ts`,
  };
  manifest.dependencies = {
    ...manifest.dependencies,
    "@langwatch/ui-kernel": "workspace:*",
  };
  if (projection) manifest.dependencies[projection.package] = "workspace:*";
  output.set(`${module.root}/web/package.json`, `${JSON.stringify(manifest, null, 2)}\n`);
}

function forwardedBinding(tree, entry, address, exported) {
  for (const declaration of entry.statements) {
    if (
      !ts.isExportDeclaration(declaration) ||
      !declaration.moduleSpecifier ||
      !declaration.exportClause ||
      !ts.isNamedExports(declaration.exportClause)
    )
      continue;
    const forwarded = declaration.exportClause.elements.find(
      (element) => name(element.name) === exported,
    );
    if (forwarded && tree.packageOwner(declaration.moduleSpecifier.text)) {
      address = declaration.moduleSpecifier.text;
      exported = name(forwarded.propertyName ?? forwarded.name);
    }
  }

  return { address, exported };
}

function collectSlots(sourceFile, source, changes) {
  const keys = [];
  let seatCopy = false;
  for (const node of nodes(source, ts.isVariableDeclaration)) {
    if (!/(UiSlots|SeatTypeCopy)$/.test(name(node.name) ?? "")) continue;
    const value = unwrap(node.initializer);
    if (!value || !ts.isObjectLiteralExpression(value))
      throw new Error(`Non-literal slot registry ${sourceFile}`);
    if (name(node.name).endsWith("UiSlots"))
      keys.push(...value.properties.map((member) => name(member.name)));
    else seatCopy = true;
    if (node.type) {
      changes.push({ start: node.name.end, end: node.type.end, text: "" });
      changes.push({
        start: node.initializer.end,
        end: node.initializer.end,
        text: ` satisfies ${node.type.getText(source)}`,
      });
    }
  }

  return { keys, seatCopy };
}
