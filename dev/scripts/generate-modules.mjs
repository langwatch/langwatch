/**
 * All modules are installed; entitlement refuses unlicensed requests rather
 * than omitting enterprise routes.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve, dirname, relative } from "node:path";

const REPOSITORY_ROOT = resolve(import.meta.dirname, "../..");
const SERVER_LIST = "modules/server-modules.generated.ts";
const WEB_LIST = "modules/web-modules.generated.ts";
const SERVER_MEMBERS = "modules/server-module-members.generated.ts";
const MODULES_PACKAGE = "modules/package.json";

/** `api-key` reads as `apiKey`, which is how a module names its declaration. */
function camelCase(id) {
  return id.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function hasDeclarationExport({ half, manifest, entry, indexPath }) {
  if (half !== "web") return existsSync(indexPath);
  const exported = manifest.exports?.["./declaration"];
  const target =
    typeof exported === "string"
      ? exported
      : (exported?.["langwatch-declaration-source"] ?? exported?.default);
  return target === `./src/${entry.id}.web.ts`;
}

/** Every catalogue entry whose half exists on disk and exports its declaration. */
function declarationsFor({ root, catalogue, half, suffix }) {
  // Directories renamed to process/browser; declaration files keep their old stem for now.
  const dir = half === "server" ? "process" : "browser";
  const declarations = [];
  for (const entry of catalogue.features) {
    const packagePath = resolve(root, entry.root, dir, "package.json");
    const declarationPath = resolve(root, entry.root, dir, "src", `${entry.id}.${half}.ts`);
    const indexPath = resolve(root, entry.root, dir, "src", "index.ts");
    if (!existsSync(packagePath)) continue;
    if (!existsSync(declarationPath)) continue;
    const manifest = JSON.parse(readFileSync(packagePath, "utf8"));
    if (!hasDeclarationExport({ half, manifest, entry, indexPath })) continue;

    const symbol = `${camelCase(entry.id)}${suffix}`;
    const indexSource = readFileSync(half === "web" ? declarationPath : indexPath, "utf8");
    if (!new RegExp(`\\b${symbol}\\b`).test(indexSource)) continue;

    declarations.push({
      id: entry.id,
      symbol,
      package: manifest.name,
      specifier: half === "web" ? `${manifest.name}/declaration` : manifest.name,
    });
  }
  return declarations.toSorted((one, other) => one.symbol.localeCompare(other.symbol));
}

/**
 * What one module's App declared it reads (`static readonly reads`) — a
 * read of the declaration, not a second list to keep in sync. Lets a
 * reviewer see every client a build opens, on one page, without booting it.
 */
function membersFor({ root, entry }) {
  const appDirectory = resolve(root, entry.root, "process", "src", "app");
  if (!existsSync(appDirectory)) return [];

  const apps = readdirSync(appDirectory).filter((name) => name.endsWith(".app.ts"));
  const declared = new Set();
  for (const app of apps) {
    const source = readFileSync(resolve(appDirectory, app), "utf8");
    const match = source.match(/static\s+readonly\s+reads\s*=\s*(?:reads\()?\[?([^);\]]*)/);
    if (!match?.[1]) continue;
    for (const name of match[1].matchAll(/["'`]([A-Za-z][\w]*)["'`]/g)) declared.add(name[1]);
  }
  return [...declared].toSorted();
}

/** Every installed module's declaration, as the manifest records it. */
function memberSourceFor({ root, catalogue }) {
  const rows = [];
  for (const entry of catalogue.features) {
    const packageJsonPath = resolve(root, entry.root, "process", "package.json");
    if (!existsSync(packageJsonPath)) continue;
    rows.push([entry.id, membersFor({ root, entry })]);
  }
  rows.toSorted(([one], [other]) => one.localeCompare(other));

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

/**
 * Every installed module that declares a config schema, in name order. Found
 * the way the declaration lists are: by the name a module's contract exports,
 * so a module that declares none contributes no key and no slice.
 */
function moduleConfigsFor({ root, catalogue }) {
  const configs = [];
  for (const entry of catalogue.features) {
    const packagePath = resolve(root, entry.root, "contract", "package.json");
    const configPath = resolve(root, entry.root, "contract", "src", `${entry.id}.config.ts`);
    const indexPath = resolve(root, entry.root, "contract", "src", "index.ts");
    if (!existsSync(packagePath)) continue;
    if (!existsSync(configPath)) continue;
    if (!existsSync(indexPath)) continue;

    const symbol = `${camelCase(entry.id)}ServerConfigSchema`;
    if (!new RegExp(`export const ${symbol}\\b`).test(readFileSync(configPath, "utf8"))) continue;
    if (!readFileSync(indexPath, "utf8").includes(`./${entry.id}.config`)) continue;

    configs.push({
      id: entry.id,
      symbol,
      specifier: JSON.parse(readFileSync(packagePath, "utf8")).name,
    });
  }
  return configs.toSorted((one, other) => one.id.localeCompare(other.id));
}

/** The generated source for one list, imports first and the array last. */
function sourceFor({ declarations, constant, half }) {
  const imports = declarations.map(
    (declaration) => `import { ${declaration.symbol} } from "${declaration.specifier}";`,
  );
  const entries = declarations.map((declaration) =>
    half === "web"
      ? `  ${declaration.symbol} satisfies { readonly name: "${declaration.id}" },`
      : `  ${declaration.symbol},`,
  );
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

function packageSourceFor({ root, catalogue, configs }) {
  const manifest = JSON.parse(readFileSync(resolve(root, MODULES_PACKAGE), "utf8"));
  const installed = [
    ...declarationsFor({ root, catalogue, half: "server", suffix: "Server" }),
    ...declarationsFor({ root, catalogue, half: "web", suffix: "Web" }),
    ...configs.map((config) => ({ package: config.specifier })),
  ];

  // No generated file imports the kernel since `createServerApp` was removed,
  // but `modules/tsconfig.json` still references its build project and
  // `createProcessApp` (ARCHITECTURE.md §16) will import it again. Dropping it
  // means regenerating references, so it stays declared.
  manifest.dependencies = Object.fromEntries(
    [...new Set(["@langwatch/kernel", ...installed.map((declaration) => declaration.package)])]
      .toSorted()
      .map((name) => [name, "workspace:*"]),
  );

  return `${JSON.stringify(manifest, undefined, 2)}\n`;
}

function rendererFiles(directory) {
  if (!existsSync(directory)) return [];
  const result = [];
  for (const item of readdirSync(directory, { withFileTypes: true }).toSorted((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    if (["node_modules", "dist", "__tests__", "__mocks__"].includes(item.name)) continue;
    const file = resolve(directory, item.name);
    if (item.isDirectory()) {
      result.push(...rendererFiles(file));
      continue;
    }
    if (!/\.tsx?$/.test(file)) continue;
    if (/\.test\./.test(file)) continue;
    if (item.name === "browser-renderers.generated.ts") continue;
    result.push(file);
  }
  return result;
}
function rendererKind(ts, file, declaration) {
  if (!ts.isIdentifier(declaration.name)) return null;
  const name = declaration.name.text;
  if (name === "browserDrawers" && file.endsWith("/browser-drawers.ts")) return "drawers";
  if (name.endsWith("UiSlots")) return "slots";
  if (name.endsWith("Failures")) return "failures";
  if (name.endsWith("SeatTypeCopy")) return "seatCopy";
  if (!name.endsWith("PageLoaders")) return null;
  let value = declaration.initializer;
  while (value && (ts.isAsExpression(value) || ts.isSatisfiesExpression(value)))
    value = value.expression;
  if (!value) return null;
  if (!ts.isObjectLiteralExpression(value)) return null;
  return value.properties.some((property) => property.name && ts.isStringLiteral(property.name))
    ? "pages"
    : null;
}
function rendererExports(ts, file) {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const result = [];
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    if (!statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword))
      continue;
    for (const declaration of statement.declarationList.declarations) {
      const kind = rendererKind(ts, file, declaration);
      if (kind) result.push({ kind, name: declaration.name.text, file });
    }
  }
  return result;
}

/** Literal renderer keys come from the adapters; declarations alone own their URLs. */
export function generateBrowserRenderers({ root = REPOSITORY_ROOT } = {}) {
  const ts = createRequire(resolve(REPOSITORY_ROOT, "packages/architecture-enforcer/package.json"))(
    "typescript",
  );
  const registryPath = "apps/ui/src/features/browser-renderers.generated.ts";
  const records = rendererFiles(resolve(root, "apps/ui/src/features")).flatMap((file) =>
    rendererExports(ts, file),
  );
  const imports = [];
  const entries = { pages: [], drawers: [], slots: [], failures: [], seatCopy: [] };
  for (const record of records) {
    const alias = `renderers${imports.length}`;
    let specifier = relative(dirname(resolve(root, registryPath)), record.file);
    if (!specifier.startsWith(".")) specifier = `./${specifier}`;
    imports.push(`import { ${record.name} as ${alias} } from ${JSON.stringify(specifier)};`);
    const row =
      record.kind === "failures" ? `  ${JSON.stringify(record.name)}: ${alias},` : `  ...${alias},`;
    entries[record.kind].push(row);
  }
  const { pages, drawers, slots, failures, seatCopy } = entries;
  if (!drawers.length) return {};
  return {
    [registryPath]: [
      "/** Generated by generate-modules.mjs; URLs belong to web declarations. */",
      ...imports,
      "",
      "export const browserPageRenderers = {",
      ...pages,
      "} as const;",
      "",
      "export const browserDrawerRenderers = {",
      ...drawers,
      "} as const;",
      "",
      "export const browserSlotRenderers = {",
      ...slots,
      "} as const;",
      "",
      "export const browserFailureInterceptors = {",
      ...failures,
      "} as const;",
      "",
      "export const browserSeatTypeCopy = {",
      ...seatCopy,
      "} as const;",
      "",
    ].join("\n"),
  };
}

function pairingSource({ root, catalogue }) {
  const web = catalogue.features.filter((entry) =>
    existsSync(resolve(root, entry.root, "web/package.json")),
  );
  const paired = web.filter((entry) =>
    existsSync(resolve(root, entry.root, "server/package.json")),
  );
  const packages = Object.fromEntries(
    web.map((entry) => [
      entry.id,
      JSON.parse(readFileSync(resolve(root, entry.root, "web/package.json"), "utf8")).name,
    ]),
  );
  return [
    'import type { serverModules } from "./server-modules.generated";',
    `export const webModulePackages = ${JSON.stringify(packages, null, 2)} as const;`,
    `type PairedOnDisk = ${paired.map((entry) => JSON.stringify(entry.id)).join(" | ") || "never"};`,
    'type MissingWeb = Exclude<PairedOnDisk, (typeof webModules)[number]["name"]>;',
    'type MissingServer = Exclude<PairedOnDisk, (typeof serverModules)[number]["name"]>;',
    "export const webModulePairing = {} satisfies {",
    '  [Id in `missing web half "${MissingWeb}"` | `missing server half "${MissingServer}"`]: never;',
    "};",
    "",
  ].join("\n");
}

/** Both lists, as the text that belongs on disk. */
export function generateModuleLists({ root = REPOSITORY_ROOT } = {}) {
  const catalogue = JSON.parse(readFileSync(resolve(root, "modules/catalogue.json"), "utf8"));
  const configs = moduleConfigsFor({ root, catalogue });

  return {
    [SERVER_LIST]: sourceFor({
      declarations: declarationsFor({ root, catalogue, half: "server", suffix: "Server" }),
      constant: "serverModules",
      half: "server",
    }),
    [WEB_LIST]:
      sourceFor({
        declarations: declarationsFor({ root, catalogue, half: "web", suffix: "Web" }),
        constant: "webModules",
        half: "web",
      }) + pairingSource({ root, catalogue }),
    [SERVER_MEMBERS]: memberSourceFor({ root, catalogue }),
    [MODULES_PACKAGE]: packageSourceFor({ root, catalogue, configs }),
    ...generateBrowserRenderers({ root }),
  };
}

if (process.argv[1] === import.meta.filename) {
  const generated = generateModuleLists();
  for (const [path, source] of Object.entries(generated)) {
    if (process.argv.includes("--dry-run")) {
      process.stdout.write(`Would generate ${path} (${source.split("\n").length - 1} lines)\n`);
    } else {
      writeFileSync(resolve(REPOSITORY_ROOT, path), source, "utf8");
      process.stdout.write(`Wrote ${path}\n`);
    }
  }
}
