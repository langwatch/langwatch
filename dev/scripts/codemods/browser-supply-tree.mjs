import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve, relative } from "node:path";

export const root = resolve(import.meta.dirname, "../../..");
export const ts = createRequire(resolve(root, "packages/architecture-enforcer/package.json"))(
  "typescript",
);
export const read = (file) => readFileSync(resolve(root, file), "utf8");
export const json = (file) => JSON.parse(read(file));
export const camel = (id) => id.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
export const quote = JSON.stringify;
export function parse(file, text = read(file)) {
  const source = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  if (source.parseDiagnostics.length)
    throw new Error(`Cannot parse ${file}: ${source.parseDiagnostics[0].messageText}`);
  return source;
}
export function walk(node, visit) {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}
export function nodes(source, predicate) {
  const result = [];
  walk(source, (node) => {
    if (predicate(node)) result.push(node);
  });
  return result;
}
function isWrapperExpression(node) {
  return (
    ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node)
  );
}
export function unwrap(node) {
  while (node && isWrapperExpression(node)) node = node.expression;
  return node;
}
export function prop(node, key) {
  return node?.properties?.find((item) => item.name && name(item.name) === key)?.initializer;
}
function isNameLiteral(node) {
  return ts.isStringLiteral(node) || ts.isIdentifier(node) || ts.isNumericLiteral(node);
}
export function name(node) {
  return node && isNameLiteral(node) ? node.text : void 0;
}
export function variable(source, key) {
  return nodes(source, ts.isVariableDeclaration).find((node) => name(node.name) === key);
}
export function files(directory) {
  if (!existsSync(resolve(root, directory))) return [];
  return readdirSync(resolve(root, directory), { withFileTypes: true })
    .flatMap((entry) => {
      if (["node_modules", "dist", ".git"].includes(entry.name)) return [];
      const file = `${directory}/${entry.name}`;
      return entry.isDirectory() ? files(file) : [file];
    })
    .toSorted((a, b) => (a < b ? -1 : Number(a > b)));
}
export function resolveLocal(file, specifier) {
  const base = relative(root, resolve(root, dirname(file), specifier));
  return [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`].find(
    (candidate) => existsSync(resolve(root, candidate)),
  );
}
export function edits(text, changes) {
  const sorted = changes.toSorted((a, b) => b.start - a.start);
  let lastStart = text.length;
  for (const change of sorted) {
    if (change.end > lastStart) throw new Error("Overlapping source edits");
    text = text.slice(0, change.start) + change.text + text.slice(change.end);
    lastStart = change.start;
  }
  return text;
}
function literalConstant(sources, identifier) {
  const declarations = [...sources.values()].flatMap((source) =>
    nodes(source, ts.isVariableDeclaration).filter((node) => name(node.name) === identifier),
  );
  const values = [
    ...new Set(declarations.map((node) => name(unwrap(node.initializer))).filter(Boolean)),
  ];
  if (values.length !== 1) throw new Error(`Cannot resolve constant ${identifier}`);
  return values[0];
}
export function inventory() {
  const modules = json("modules/catalogue.json").features.map((entry) => {
    const file = `${entry.root}/web/package.json`;
    return { ...entry, manifest: existsSync(resolve(root, file)) ? json(file) : null };
  });
  const byPackage = new Map(
    modules.filter((entry) => entry.manifest).map((entry) => [entry.manifest.name, entry]),
  );
  const packageOwner = (address) => byPackage.get(address?.split("/").slice(0, 2).join("/"));
  const catalogue = json("apps/ui/src/features/catalogue.json");
  const owners = new Map(
    catalogue.features.map((entry) => {
      const owner = packageOwner(entry.uses.screens[0]);
      return [entry.root, owner];
    }),
  );
  const featureFiles = files("apps/ui/src/features").filter((file) => /\.[cm]?tsx?$/.test(file));
  const sources = new Map(featureFiles.map((file) => [file, parse(file)]));
  const installations = [];
  const drawers = [];
  const loaders = [];
  collectFeatureSources(sources, installations, drawers, loaders, owners, packageOwner);
  const routeFile = "apps/ui/src/model/ui-route-table.ts";
  const routeSource = parse(routeFile);
  const routes = [];
  const layoutCounts = new Map();

  collect(
    routes,
    layoutCounts,
    routeFile,
    unwrap(variable(routeSource, "uiRouteTable").initializer),
  );
  const annotationFile = "apps/ui/src/features/annotation/ui/sections/annotation-routes.tsx";
  const annotationSource = sources.get(annotationFile);
  const anchor = routes.filter((route) => route.anchor === "project");
  if (anchor.length !== 1) throw new Error("Expected one project route anchor");
  for (const node of nodes(annotationSource, ts.isCallExpression).filter(
    (node) => node.expression.getText(annotationSource) === "annotationRoute",
  )) {
    routes.push({
      path: name(node.arguments[0]),
      page: name(node.arguments[1]),
      parents: [...anchor[0].parents, anchor[0].instance],
      file: annotationFile,
      node,
    });
  }
  const pages = [...new Map(routes.map((route) => [route.page, route])).values()];
  for (const page of pages) {
    const loader = loaders.find((entry) => entry.page === page.page);
    if (!loader) throw new Error(`Missing loader for ${page.page}`);
    page.loader = loader;
    page.owner = owners.get(loader.folder)?.id ?? "shell";
  }
  return {
    modules,
    byPackage,
    packageOwner,
    catalogue,
    owners,
    sources,
    installations,
    drawers,
    loaders,
    routes,
    pages,
  };
}
if (process.argv[1] === import.meta.filename) {
  const tree = inventory();
  console.log(
    `${tree.modules.filter((entry) => entry.manifest).length} web packages; ${tree.installations.length} uiFeature calls; ${tree.drawers.length} drawers; ${tree.pages.length} distinct page keys; ${tree.routes.length} route occurrences`,
  );
}

function collect(routes, layoutCounts, routeFile, array, parents = []) {
  for (const entry of array.elements) {
    if (!ts.isObjectLiteralExpression(entry)) continue;
    const page = name(prop(entry, "page"));
    if (!page) continue;
    const path = name(prop(entry, "path"));
    const instance = path ? void 0 : `${page}#${layoutCounts.get(page) ?? 0}`;
    if (instance) layoutCounts.set(page, (layoutCounts.get(page) ?? 0) + 1);
    routes.push({
      page,
      path,
      parents,
      instance,
      anchor: name(prop(entry, "webRouteParent")),
      node: entry,
      file: routeFile,
    });
    const children = prop(entry, "children");
    if (children)
      collect(routes, layoutCounts, routeFile, children, [...parents, instance ?? page]);
  }
}

function collectFeatureSources(sources, installations, drawers, loaders, owners, packageOwner) {
  const context = { sources, installations, drawers, loaders, owners, packageOwner };
  for (const [file, source] of sources) {
    for (const node of nodes(source, ts.isVariableDeclaration)) {
      collectFeatureVariable(context, file, source, node);
    }
  }
}
function collectFeatureVariable(context, file, source, node) {
  const value = unwrap(node.initializer);
  if (!value) return;
  const folder = file.split("/")[4];
  if (ts.isObjectLiteralExpression(value)) {
    if (name(node.name)?.endsWith("PageLoaders"))
      collectLoaders(context.loaders, file, folder, source, node, value);
    return;
  }
  if (!ts.isCallExpression(value)) return;
  if (value.expression.getText(source) !== "uiFeature") return;
  const options = value.arguments[0];
  const address = name(prop(options, "name"));
  const owner = context.packageOwner(address) ?? context.owners.get(folder);
  context.installations.push({
    file,
    folder,
    symbol: name(node.name),
    owner: owner?.id ?? "shell",
    address,
    node,
    options,
    source,
  });
  const registry = prop(options, "drawers");
  if (!registry) return;
  for (const member of registry.properties) {
    const key = ts.isComputedPropertyName(member.name)
      ? literalConstant(context.sources, member.name.expression.getText(source))
      : name(member.name);
    context.drawers.push({ name: key, file, folder, owner: owner?.id, member });
  }
}
function collectLoaders(loaders, file, folder, source, node, value) {
  for (const member of value.properties) {
    if (ts.isSpreadAssignment(member)) continue;
    if (!member.name) throw new Error(`Unnamed loader in ${file}`);
    if (!ts.isPropertyAssignment(member)) throw new Error(`Unsupported loader in ${file}`);
    loaders.push({
      page: name(member.name),
      file,
      folder,
      registry: name(node.name),
      expression: member.initializer.getText(source),
      member,
      node,
    });
  }
}
