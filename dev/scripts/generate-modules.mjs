/**
 * Writes the module lists a process installs, from modules/catalogue.json.
 *
 * A module declares its own halves; no application names one. The core tier is
 * what the open-source build compiles, so the checked-in files carry core
 * entries only and an enterprise build regenerates with
 * LANGWATCH_BUILD_TIER=enterprise, which appends the enterprise tier rather
 * than guarding it at runtime (ADR-144 s6).
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const REPOSITORY_ROOT = resolve(import.meta.dirname, "../..");
const SERVER_LIST = "modules/server-modules.generated.ts";
const WEB_LIST = "modules/web-modules.generated.ts";
const SERVER_MEMBERS = "modules/server-module-members.generated.ts";

/** `api-key` reads as `apiKey`, which is how a module names its declaration. */
function camelCase(id) {
  return id.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

/** The tier an entry belongs to, from the entry and never from its path. */
function tierOf(entry) {
  return entry.tier ?? (entry.root.startsWith("enterprise/") ? "enterprise" : "core");
}

/** Every catalogue entry whose half exists on disk and exports its declaration. */
function declarationsFor({ root, catalogue, half, suffix, tiers }) {
  const declarations = [];
  for (const entry of catalogue.features) {
    if (!tiers.includes(tierOf(entry))) continue;

    const packagePath = resolve(root, entry.root, half, "package.json");
    const declarationPath = resolve(root, entry.root, half, "src", `${entry.id}.${half}.ts`);
    const indexPath = resolve(root, entry.root, half, "src", "index.ts");
    if (!existsSync(packagePath) || !existsSync(declarationPath) || !existsSync(indexPath)) continue;

    const symbol = `${camelCase(entry.id)}${suffix}`;
    if (!new RegExp(`\\b${symbol}\\b`).test(readFileSync(indexPath, "utf8"))) continue;

    declarations.push({ symbol, package: JSON.parse(readFileSync(packagePath, "utf8")).name });
  }
  return declarations.sort((one, other) => one.symbol.localeCompare(other.symbol));
}

/**
 * What one module's App declared it reads, off `static readonly reads`.
 *
 * The App is the single source: `reads("clock", "logger")` is both the type's
 * source and boot's, so this file is a read of the declaration rather than a
 * second list to keep in agreement with it. It exists so a reviewer can see
 * every client this build makes a process open, on one page, without booting
 * anything - and so a module that quietly starts reading Redis shows up in a
 * diff.
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

/** Every core module's declaration, as the manifest records it. */
function memberSourceFor({ root, catalogue, tiers }) {
  const rows = [];
  for (const entry of catalogue.features) {
    if (!tiers.includes(tierOf(entry))) continue;
    if (!existsSync(resolve(root, entry.root, "server", "package.json"))) continue;
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

/** Both lists for one tier, as the text that belongs on disk. */
export function generateModuleLists({ root = REPOSITORY_ROOT, tier = "core" } = {}) {
  const catalogue = JSON.parse(readFileSync(resolve(root, "modules/catalogue.json"), "utf8"));
  const tiers = tier === "enterprise" ? ["core", "enterprise"] : ["core"];

  return {
    [SERVER_LIST]: sourceFor({
      declarations: declarationsFor({ root, catalogue, half: "server", suffix: "Server", tiers }),
      constant: "serverModules",
      half: "server",
    }),
    [WEB_LIST]: sourceFor({
      declarations: declarationsFor({ root, catalogue, half: "web", suffix: "Web", tiers }),
      constant: "webModules",
      half: "web",
    }),
    [SERVER_MEMBERS]: memberSourceFor({ root, catalogue, tiers }),
  };
}

if (process.argv[1] === import.meta.filename) {
  const tier = process.env.LANGWATCH_BUILD_TIER === "enterprise" ? "enterprise" : "core";
  const generated = generateModuleLists({ tier });
  for (const [path, source] of Object.entries(generated)) {
    writeFileSync(resolve(REPOSITORY_ROOT, path), source, "utf8");
    process.stdout.write(`Wrote ${path}\n`);
  }
}
