/**
 * Writes the module lists a process installs, from modules/catalogue.json.
 *
 * One list, every module. There is no separate enterprise build: a licence
 * lives in the running application, against an organization, and entitlement
 * refuses per request. So an enterprise module is installed like any other and
 * a deployment without a licence is refused at the door, never by an absent
 * route.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const REPOSITORY_ROOT = resolve(import.meta.dirname, "../..");
const SERVER_LIST = "modules/server-modules.generated.ts";
const WEB_LIST = "modules/web-modules.generated.ts";
const SERVER_MEMBERS = "modules/server-module-members.generated.ts";
const MODULES_PACKAGE = "modules/package.json";

/** `api-key` reads as `apiKey`, which is how a module names its declaration. */
function camelCase(id) {
  return id.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

/** Every catalogue entry whose half exists on disk and exports its declaration. */
function declarationsFor({ root, catalogue, half, suffix }) {
  const declarations = [];
  for (const entry of catalogue.features) {
    const packagePath = resolve(root, entry.root, half, "package.json");
    const declarationPath = resolve(root, entry.root, half, "src", `${entry.id}.${half}.ts`);
    const indexPath = resolve(root, entry.root, half, "src", "index.ts");
    if (!existsSync(packagePath)) continue;
    if (!existsSync(declarationPath)) continue;
    if (!existsSync(indexPath)) continue;

    const symbol = `${camelCase(entry.id)}${suffix}`;
    const indexSource = readFileSync(indexPath, "utf8");
    if (!new RegExp(`\\b${symbol}\\b`).test(indexSource)) continue;

    declarations.push({ symbol, package: JSON.parse(readFileSync(packagePath, "utf8")).name });
  }
  return declarations.sort((one, other) => one.symbol.localeCompare(other.symbol));
}

/**
 * What one module's App declared it reads (`static readonly reads`) — a
 * read of the declaration, not a second list to keep in sync. Lets a
 * reviewer see every client a build opens, on one page, without booting it.
 */
function membersFor({ root, entry }) {
  const appDirectory = resolve(root, entry.root, "server", "src", "app");
  if (!existsSync(appDirectory)) return [];

  const apps = readdirSync(appDirectory).filter((name) => name.endsWith(".app.ts"));
  const declared = new Set();
  for (const app of apps) {
    const source = readFileSync(resolve(appDirectory, app), "utf8");
    const match = source.match(/static\s+readonly\s+reads\s*=\s*(?:reads\()?\[?([^);\]]*)/);
    if (!match?.[1]) continue;
    for (const name of match[1].matchAll(/["'`]([A-Za-z][\w]*)["'`]/g)) declared.add(name[1]);
  }
  return [...declared].sort();
}

/** Every installed module's declaration, as the manifest records it. */
function memberSourceFor({ root, catalogue }) {
  const rows = [];
  for (const entry of catalogue.features) {
    const packageJsonPath = resolve(root, entry.root, "server", "package.json");
    if (!existsSync(packageJsonPath)) continue;
    rows.push([entry.id, membersFor({ root, entry })]);
  }
  rows.sort(([one], [other]) => one.localeCompare(other));

  const entries = rows.map(([id, members]) => {
    const key = /^[a-z][a-zA-Z0-9]*$/.test(id) ? id : JSON.stringify(id);
    return `  ${key}: [${members.map((member) => JSON.stringify(member)).join(", ")}],`;
  });

  return [
    "/** Generated from modules/catalogue.json. Do not edit by hand. */",
    "/** Run `pnpm generate:modules` to rewrite it. */",
    "",
    "/**",
    " * What each installed module's App declared it reads, in name order.",
    " *",
    " * Boot builds exactly this union, plus whatever each module's chosen",
    " * repository tier requires, and refuses by module and member when this",
    " * process cannot supply one.",
    " */",
    "export const serverModuleMembers = {",
    ...entries,
    "} as const;",
    "",
  ].join("\n");
}

/** The generated source for one list, imports first and the array last. */
function sourceFor({ declarations, constant, half }) {
  const imports = declarations.map(
    (declaration) => `import { ${declaration.symbol} } from "${declaration.package}";`,
  );
  const entries = declarations.map((declaration) => `  ${declaration.symbol},`);
  const empty = `/** No module declares a ${half} half yet. */\nexport const ${constant} = [] as const;\n`;
  const filled = [
    ...imports,
    "",
    `/** Every installed module's ${half} declaration, in name order. */`,
    `export const ${constant} = [`,
    ...entries,
    "] as const;",
    "",
  ].join("\n");

  return [
    "/** Generated from modules/catalogue.json. Do not edit by hand. */",
    `/** Run \`pnpm generate:modules\` to rewrite it. */`,
    "",
    declarations.length === 0 ? empty : filled,
  ].join("\n");
}

/**
 * `@langwatch/installed-modules`'s dependencies, derived from the very
 * declarations the server list imports.
 *
 * Kept generated rather than hand-written because the two drifted: the lists
 * named every module while this file declared only the core ones, so the
 * generator died resolving `@langwatch/enterprise-licensing-server` and no
 * build carrying the enterprise modules could be produced at all.
 */
function packageSourceFor({ root, catalogue }) {
  const manifest = JSON.parse(readFileSync(resolve(root, MODULES_PACKAGE), "utf8"));
  const installed = declarationsFor({ root, catalogue, half: "server", suffix: "Server" });

  manifest.dependencies = Object.fromEntries(
    [...new Set(installed.map((declaration) => declaration.package))]
      .sort()
      .map((name) => [name, "workspace:*"]),
  );

  return `${JSON.stringify(manifest, undefined, 2)}\n`;
}

/** Both lists, as the text that belongs on disk. */
export function generateModuleLists({ root = REPOSITORY_ROOT } = {}) {
  const catalogue = JSON.parse(readFileSync(resolve(root, "modules/catalogue.json"), "utf8"));

  return {
    [SERVER_LIST]: sourceFor({
      declarations: declarationsFor({ root, catalogue, half: "server", suffix: "Server" }),
      constant: "serverModules",
      half: "server",
    }),
    [WEB_LIST]: sourceFor({
      declarations: declarationsFor({ root, catalogue, half: "web", suffix: "Web" }),
      constant: "webModules",
      half: "web",
    }),
    [SERVER_MEMBERS]: memberSourceFor({ root, catalogue }),
    [MODULES_PACKAGE]: packageSourceFor({ root, catalogue }),
  };
}

if (process.argv[1] === import.meta.filename) {
  const generated = generateModuleLists();
  for (const [path, source] of Object.entries(generated)) {
    writeFileSync(resolve(REPOSITORY_ROOT, path), source, "utf8");
    process.stdout.write(`Wrote ${path}\n`);
  }
}
