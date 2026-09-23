#!/usr/bin/env node
// Lift menu leaves with their gates and order; the shell keeps group and product policy.
import { runInNewContext } from "node:vm";

import { applyPlan } from "./browser-supply-declarations.mjs";
import {
  inventory,
  ts,
  nodes,
  prop,
  name,
  unwrap,
  parse,
  read,
  camel,
  quote,
  variable,
} from "./browser-supply-tree.mjs";

export function navigationPlan() {
  const tree = inventory();
  const output = new Map();
  const entries = [];
  const sources = new Map();
  const base = "modules/navigation/browser/src/model";
  const literal = (node, source) => {
    if (ts.isStringLiteral(node)) return node.text;
    if (ts.isIdentifier(node)) {
      const declaration = variable(source, node.text);
      if (declaration?.initializer && ts.isStringLiteral(declaration.initializer))
        return declaration.initializer.text;
    }
    throw new Error(`Non-literal navigation address: ${node.getText(source)}`);
  };

  collectNavigationItems(tree, entries, literal, base, sources);
  const settings = parse(`${base}/settings-menu.ts`);
  sources.set(settings.fileName, settings);
  const functions = new Map(
    settings.statements.filter(ts.isFunctionDeclaration).map((node) => [name(node.name), node]),
  );

  const groups = collectSettingsItems(tree, entries, literal, settings, functions);
  const gateNames = [
    "hasPermission",
    "isSaaS",
    "showEnterpriseNav",
    "isLiteMember",
    "hasOpsAccess",
    "isPlatformAdmin",
  ];
  emitNavigation(tree, entries, sources, gateNames, output);
  const cases = verifySettings(settings, entries, groups, gateNames);
  return { output, entries, cases };
}
if (process.argv[1] === import.meta.filename) {
  const plan = navigationPlan();
  const changed = applyPlan(plan.output, process.argv.includes("--write"));
  for (const channel of new Set(plan.entries.map((entry) => entry.channel)))
    console.log(
      `${channel}: ${plan.entries.filter((entry) => entry.channel === channel).length} entries`,
    );
  console.log(
    `${process.argv.includes("--write") ? "wrote" : "would write"} ${plan.entries.length} navigation contributions across ${changed.length} module files; unmatched addresses: 0`,
  );
  console.log(
    `settings equivalence: ${plan.cases} gate combinations passed; 19 action commands stay in navigation`,
  );
  console.log(
    "cutover derives the four item registries from these declarations; product/group policy stays in navigation",
  );
}

function add(tree, entries, literal, node, source, channel, order, gate = "true", key) {
  const address = prop(node, "path") ?? prop(node, "href");
  const path = literal(address, source).replace(/\[([^\]]+)\]/g, ":$1");
  const route = tree.routes.find((item) => item.path === path);
  if (!route) throw new Error(`Unclaimed navigation address ${path}`);
  const page = tree.pages.find((item) => item.page === route.page);
  const fields = node.properties
    .filter((member) => !["path", "href"].includes(name(member.name)))
    .map((member) => member.getText(source));
  const routeIndex = tree.routes
    .filter((item) => item.page === route.page)
    .findIndex((item) => item.path === path);
  const data = `{ ${fields.join(", ")} }`;
  entries.push({
    owner: page.owner,
    page: page.page,
    route: routeIndex,
    channel,
    order,
    gate,
    key,
    data,
    path,
    source: source.fileName,
  });
}

function expand(settings, functions, expression, gate = "true") {
  const node = unwrap(expression);
  if (ts.isArrayLiteralExpression(node))
    return node.elements.flatMap((item) =>
      expand(settings, functions, ts.isSpreadElement(item) ? item.expression : item, gate),
    );
  if (ts.isConditionalExpression(node)) {
    const condition = node.condition.getText(settings);
    return [
      ...expand(settings, functions, node.whenTrue, `(${gate}) && (${condition})`),
      ...expand(settings, functions, node.whenFalse, `(${gate}) && !(${condition})`),
    ];
  }
  if (ts.isCallExpression(node)) {
    const fn = functions.get(node.expression.getText(settings));
    if (!fn) throw new Error(`Unsupported menu helper ${node.getText(settings)}`);
    const returned = nodes(fn, ts.isReturnStatement)[0]?.expression;
    if (!returned) throw new Error(`No return in menu helper ${name(fn.name)}`);
    return expand(settings, functions, returned, gate);
  }
  if (ts.isObjectLiteralExpression(node)) return [{ node, gate }];
  throw new Error(`Unsupported menu expression ${node.getText(settings)}`);
}

function scanRegistryGroup(tree, entries, literal, source, registries, field) {
  for (const registry of registries) {
    const value = unwrap(variable(source, registry).initializer);
    const rows = ts.isArrayLiteralExpression(value) ? value.elements : value.properties;
    rows.forEach((node, order) =>
      add(
        tree,
        entries,
        literal,
        ts.isPropertyAssignment(node) ? node.initializer : node,
        source,
        field === "section" ? registry : field,
        order,
        "true",
        ts.isPropertyAssignment(node) ? name(node.name) : void 0,
      ),
    );
  }
}

/** @param {string} base */
function collectNavigationItems(tree, entries, literal, base, sources) {
  /** @type {Array<[string, string[], string]>} */
  const navigationRegistries = [
    ["command-catalogue", ["navigationCommands"], "command"],
    ["project-nav-items", ["projectNavItems"], "project"],
    ["section-nav-items", ["gatewayNavItems", "governanceNavItems"], "section"],
  ];
  for (const [basename, registries, field] of navigationRegistries) {
    const source = parse(`${base}/${basename}.ts`);
    sources.set(source.fileName, source);
    scanRegistryGroup(tree, entries, literal, source, registries, field);
  }
}

function collectSettingsItems(tree, entries, literal, settings, functions) {
  const groups = [];
  for (const fn of functions.values()) {
    const returned = nodes(fn, ts.isReturnStatement)[0]?.expression;
    if (!returned || !ts.isObjectLiteralExpression(returned) || !prop(returned, "items")) continue;
    const channel = literal(prop(returned, "id"), settings);
    groups.push({ id: channel, label: literal(prop(returned, "label"), settings) });
    const groupGate =
      { "settings-ops": "hasOpsAccess", "settings-backoffice": "isPlatformAdmin" }[channel] ??
      "true";
    expand(settings, functions, prop(returned, "items"), groupGate).forEach(
      ({ node, gate }, order) => add(tree, entries, literal, node, settings, channel, order, gate),
    );
  }
  return groups;
}

function emitNavigation(tree, entries, sources, gateNames, output) {
  for (const module of tree.modules) {
    const owned = entries.filter((entry) => entry.owner === module.id);
    if (!owned.length) continue;
    const icons = navigationIcons(owned, sources);
    const lines = [
      `import { ${[...icons].toSorted((a, b) => (a < b ? -1 : Number(a > b))).join(", ")} } from "lucide-react";`,
      'import type { NavigationGates } from "@langwatch/ui-kernel";',
      `export const ${camel(module.id)}Navigation = [`,
      ...owned.map(
        (entry) =>
          `  { screen: ${quote(entry.page)}, route: ${entry.route}, channel: ${quote(entry.channel)}, order: ${entry.order}, ${entry.key ? `key: ${quote(entry.key)}, ` : ""}metadata: ${entry.data}, visible: ({ ${gateNames.filter((key) => new RegExp(`\\b${key}\\b`).test(entry.gate)).join(", ")} }: NavigationGates) => ${entry.gate} },`,
      ),
      "] as const;",
    ];
    const file = `${module.root}/web/src/model/${module.id}.browser-navigation.ts`;
    const content = `${lines.join("\n")}\n`;
    parse(file, content);
    output.set(file, content);
  }
}

function verifySettings(settings, entries, groups, gateNames) {
  const sourceWithoutImports = settings.statements
    .filter((node) => !ts.isImportDeclaration(node))
    .map((node) => node.getText(settings))
    .join("\n");
  const javascript = ts.transpileModule(sourceWithoutImports, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const iconNames = settings.statements
    .filter(ts.isImportDeclaration)
    .filter((node) => node.moduleSpecifier.text === "lucide-react")
    .flatMap((node) => node.importClause.namedBindings.elements.map((item) => name(item.name)));
  const context = { exports: {}, ...Object.fromEntries(iconNames.map((icon) => [icon, icon])) };
  runInNewContext(javascript, context);
  const permissions = [
    ...new Set(
      [...read(settings.fileName).matchAll(/hasPermission\("([^"]+)"\)/g)].map((match) => match[1]),
    ),
  ];
  const settingsEntries = entries.filter((entry) => entry.channel.startsWith("settings-"));
  let cases = 0;
  for (let mask = 0; mask < 2 ** (5 + permissions.length); mask++) {
    const gates = Object.fromEntries(
      gateNames.slice(1).map((key, index) => [key, Boolean(mask & (1 << index))]),
    );
    gates.hasPermission = (permission) =>
      Boolean(mask & (1 << (5 + permissions.indexOf(permission))));
    const expected = JSON.stringify(context.exports.settingsMenu(gates));
    const projected = groups
      .map((group) => ({
        ...group,
        items: settingsEntries
          .filter((entry) => entry.channel === group.id && runInNewContext(entry.gate, gates))
          .map((entry) => ({ ...runInNewContext(`(${entry.data})`, context), href: entry.path })),
      }))
      .filter((group) => group.items.length);
    const normalise = (groups) =>
      groups.map((group) => ({
        ...group,
        items: group.items.map((item) =>
          Object.fromEntries(Object.entries(item).toSorted(([a], [b]) => a.localeCompare(b))),
        ),
      }));
    const expectedNormalised = JSON.stringify(normalise(JSON.parse(expected)));
    const projectedNormalised = JSON.stringify(normalise(projected));
    if (expectedNormalised !== projectedNormalised)
      throw new Error(`Settings gates changed for mask ${mask}`);
    cases++;
  }
  return cases;
}

function navigationIcons(owned, sources) {
  const icons = new Set();
  for (const entry of owned) {
    const source = sources.get(entry.source);
    for (const statement of source.statements.filter(ts.isImportDeclaration)) {
      if (statement.moduleSpecifier.text !== "lucide-react") continue;
      for (const element of statement.importClause.namedBindings.elements)
        if (new RegExp(`\\b${name(element.name)}\\b`).test(entry.data))
          icons.add(name(element.name));
    }
  }

  return icons;
}
