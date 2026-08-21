/**
 * Bundles the production server entry points (server.mts, workers.ts, task.ts,
 * and the scenario child process) into dist/server/*.cjs so production runs on
 * plain `node`, not tsx.
 *
 * esbuild is used as a TRANSPILER here, not a packer. Only first-party code is
 * bundled: the app's own source plus the workspace packages (@langwatch/*,
 * langwatch), which ship raw TypeScript with `~/` aliases and extensionless
 * imports that only tsx could resolve at runtime. Every other bare specifier
 * stays a real require from node_modules — native addons, Prisma's generated
 * client, OpenTelemetry's require-patching and packages that read sibling
 * asset files all load exactly as they would under tsx.
 *
 * The flip side: everything the bundles require externally must be declared in
 * `dependencies` (pnpm's strict isolation gives the app no access to transitive
 * packages, and `--prod` drops devDependencies). The check after the build
 * enforces that, so a missing declaration fails the build here instead of the
 * image dying at boot with MODULE_NOT_FOUND.
 */

import { execFileSync } from "node:child_process";
import { cpSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { builtinModules } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { OPTIONAL_EXTERNALS } from "./bundle-optional-externals.mjs";

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(APP, "dist", "server");

// task.ts imports ./tasks.generated, which is gitignored. Regenerate it here
// (idempotent, milliseconds — run-task.sh does the same for dev) so
// `pnpm run build:server` works standalone, without start:prepare:files first.
execFileSync(
  process.execPath,
  [path.join(APP, "scripts", "generate-task-registry.mjs")],
  { stdio: "inherit" },
);

/** @type {{ dependencies?: Record<string, string>, devDependencies?: Record<string, string> }} */
const appPkg = JSON.parse(readFileSync(path.join(APP, "package.json"), "utf8"));

// The packages declared with a `workspace:` spec are raw-TypeScript source
// (extensionless imports, `~/` aliases) that only bundling can resolve — they
// get inlined. Everything else under @langwatch/ is a real prebuilt package
// (e.g. the vendored @langwatch/scenario tarball) and stays external.
const workspaceBundled = new Set(
  Object.entries({
    ...appPkg.dependencies,
    ...appPkg.devDependencies,
  })
    .filter(([, spec]) => spec.startsWith("workspace:"))
    .map(([name]) => name),
);

// Modules imported solely for their side effects (`import "pkg"`). The
// sideEffects:false waiver below would DROP these imports outright — esbuild
// sees no used bindings — so they must stay external without the waiver:
// zod-openapi/extend patches zod with .openapi(). The source scan after the
// builds fails on any bare side-effect import that is not listed here, so a
// new one can't be silently dropped.
const sideEffectImports = new Set(["zod-openapi/extend"]);

// The bare package a specifier belongs to: "tiktoken/lite" -> "tiktoken",
// "@grpc/grpc-js/foo" -> "@grpc/grpc-js".
/** @param {string} id @returns {string} */
const basePackage = (id) => {
  const parts = id.split("/");
  // parts[0] is always present, but noUncheckedIndexedAccess widens it to
  // string | undefined; `?? id` pins it back to string.
  return id.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? id);
};

// Kept external even by an inlineAll entry, each for a reason that inlining
// would break:
//
//   @opentelemetry/*  The child flushes spans at exit through the GLOBALLY
//                     registered provider. A second inlined copy of the API
//                     splits registration and flush across two registries, so
//                     every span is dropped while the process still exits 0.
//   @prisma/*         Native engines; cannot be inlined at all.
//   pino / thread-stream
//                     They start their log transport on a worker thread whose
//                     script they locate with `join(__dirname, "worker.js")`.
//                     Inlined, __dirname becomes dist/server and the lookup
//                     misses, and thread-stream reports it by rethrowing on
//                     nextTick — an UNCAUGHT exception that kills the child,
//                     not something the transport's try/catch can swallow.
//                     Every realistic configuration hits it: pretty console
//                     logs (the dev default) and the OTel log transport both
//                     create a transport.
//
// The rule of thumb for adding to this list: a package that resolves a FILE at
// runtime relative to its own location cannot be inlined, because inlining is
// exactly what moves that location.
const NEVER_INLINED = [
  /^@opentelemetry\//,
  /^@prisma\//,
  /^\.prisma(\/|$)/,
  /^pino(-|$)/,
  /^thread-stream$/,
];

/**
 * Whether a specifier gets inlined into the bundle. First-party source always
 * is; an `inlineAll` entry takes everything else with it except NEVER_INLINED.
 *
 * @param {string} id @param {boolean} inlineAll @returns {boolean}
 */
const isInlined = (id, inlineAll) => {
  // Relative (./ ../), absolute (/) and tsconfig-alias (~/, @app/, @ee/)
  // specifiers are first-party source. `.prisma/…` looks relative but is a
  // bare specifier, so it falls through and stays external like the rest. A
  // future tsconfig alias missing here fails the build loudly (the dependency
  // check below names it as an undeclared package).
  if (/^(\.\.?\/|\/|~\/|@app\/|@ee\/)/.test(id)) return true;
  // Workspace packages ship raw TypeScript, so only bundling can resolve them.
  // One inlined copy per process is the correct instance count anyway.
  if (workspaceBundled.has(basePackage(id))) return true;
  return inlineAll && !NEVER_INLINED.some((re) => re.test(id));
};

/**
 * Entries default to bundling first-party code only. `inlineAll` flips that to
 * bundling everything except NEVER_INLINED — used by the scenario child, which
 * is a fresh process per run and so pays its whole module graph every time.
 *
 * @param {boolean} inlineAll
 * @returns {import("esbuild").Plugin}
 */
const createExternalize = (inlineAll) => ({
  name: "externalize",
  setup(b) {
    b.onResolve({ filter: /.*/ }, (a) => {
      if (isInlined(a.path, inlineAll)) return;
      // Side-effect-only imports keep their side effects (no waiver), or the
      // import statement itself would be dropped.
      if (sideEffectImports.has(a.path)) {
        return { path: a.path, external: true };
      }
      // Every other bare specifier resolves from node_modules at runtime.
      // sideEffects:false lets esbuild drop external imports whose bindings go
      // unused after tree-shaking — that is what keeps the frontend-only
      // packages reached through mixed server/UI modules (chakra, monaco, …)
      // out of the server graph, exactly as inlining+tree-shaking did. Every
      // used import stays a real require and its side effects run; imports
      // with intentionally unused bindings are the sideEffectImports set
      // above, enforced by the source scan after the builds.
      return { path: a.path, external: true, sideEffects: false };
    });
  },
});

// CommonJS output (like the scenario child-process bundle). CJS is deliberate:
// `__dirname`/`__filename`/`require` are native (goose.ts's
// path.join(__dirname, "migrations") resolves to dist/server/migrations, where
// the migrations are copied below), and OTel's require-in-the-middle patches
// the external instrumentation targets, which CJS requires go through.
//
// CJS has no `import.meta`, so esbuild would leave `import.meta.url` empty.
// Point it at the bundle's own DIRECTORY URL (trailing slash) — the same dir
// __dirname resolves to. `new URL("./x", import.meta.url)` and
// createRequire(import.meta.url) both work off the directory, but
// `import.meta.url === \`file://${process.argv[1]}\`` — the run-only-if-main
// guard several CLI/seed scripts use — no longer matches, so those guards stay
// false when their code is inlined (no inlined module is the entrypoint).
// import.meta.env is Vite's build-time construct; pin it to production values
// so an empty import.meta can't throw in browser-guarded branches.
const banner = {
  js: 'const importMetaUrl = require("url").pathToFileURL(__dirname).href + "/";',
};
const define = {
  "import.meta.url": "importMetaUrl",
  "import.meta.env.DEV": "false",
  "import.meta.env.PROD": "true",
  "import.meta.env": "{}",
};

const ENTRIES = [
  { name: "server", entry: "src/server.mts" },
  { name: "workers", entry: "src/workers.ts" },
  { name: "task", entry: "src/task.ts" },
  {
    // Spawned per scenario run (src/server/scenarios/execution/
    // child-process-spawn.ts), as a FRESH process every time, so whatever this
    // entry resolves from disk at boot is paid once per simulation.
    //
    // That is why the scenario SDK is inlined here and nowhere else: left
    // external it is the single largest startup cost, because requiring it
    // walks its whole dependency graph across the pnpm symlink tree.
    //
    // @opentelemetry/* deliberately stays external. The child flushes spans at
    // exit by reaching for the globally registered provider, so a second
    // inlined copy of the OTEL API would split registration and flush across
    // two registries and drop every span while still exiting 0.
    // @see specs/scenarios/pre-compiled-child-process.feature
    name: "scenario-child-process",
    entry: "src/server/scenarios/execution/scenario-child-process.ts",
    inlineAll: true,
  },
];

rmSync(OUT_DIR, { recursive: true, force: true });

const emitMeta = process.env.EMIT_META === "1";
const declared = new Set(Object.keys(appPkg.dependencies ?? {}));
const builtins = new Set(builtinModules);
// Dynamically imported only on dev-only paths that never run in production,
// where the package is absent from the --prod install. Anything else the
// bundles reference must be declared — including dynamic imports: the
// tokenizer's lazy `import("node-fetch-cache")` runs in production, and
// leaving it undeclared would silently kill token counting.
const devOnlyDynamicImports = new Set(["selfsigned"]);
const optionalExternals = new Set(OPTIONAL_EXTERNALS);
/** @type {Map<string, Set<string>>} package -> entry names that require it */
const undeclared = new Map();
const scannedSources = new Set();
/** @type {Map<string, Set<string>>} specifier -> source files that bare-import it */
const unlistedSideEffectImports = new Map();
/** @type {Map<string, Set<string>>} specifier -> files importing JSON with no attribute */
const jsonImportsWithoutAttribute = new Map();

for (const { name, entry, inlineAll } of ENTRIES) {
  const result = await build({
    entryPoints: [path.join(APP, entry)],
    outfile: path.join(OUT_DIR, `${name}.cjs`),
    absWorkingDir: APP,
    // esbuild only consults this for the path aliases (~/, @app/, @ee/) the
    // externalize plugin skips above — tsconfig.json defines all of them, so
    // one shared config covers every entry.
    tsconfig: path.join(APP, "tsconfig.json"),
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node24",
    jsx: "automatic",
    banner,
    define,
    loader: { ".css": "empty", ".scss": "empty", ".sass": "empty" },
    // Inlined packages are tree-shaken only if esbuild can see ESM: a CJS
    // entry is opaque, so every branch of it (the voice stack included) would
    // be kept. Entries that inline nothing keep the node default.
    ...(inlineAll
      ? { mainFields: ["module", "main"], conditions: ["import"] }
      : {}),
    plugins: [createExternalize(inlineAll ?? false)],
    metafile: true,
    // Linked source maps so production stack traces name real files/lines
    // instead of bundle offsets (the entrypoints run with --enable-source-maps).
    // sourcesContent: false keeps the source text out of the shipped .map.
    sourcemap: "linked",
    sourcesContent: false,
    logLevel: "info",
    logLimit: 0,
  });
  for (const output of Object.values(result.metafile.outputs)) {
    for (const imp of output.imports) {
      if (!imp.external) continue;
      const id = imp.path;
      if (id.startsWith("node:") || builtins.has(basePackage(id))) continue;
      if (id === ".prisma" || id.startsWith(".prisma/")) continue;
      const base = basePackage(id);
      if (declared.has(base)) continue;
      if (optionalExternals.has(base)) continue;
      if (imp.kind === "dynamic-import" && devOnlyDynamicImports.has(base))
        continue;
      let entriesFor = undeclared.get(base);
      if (!entriesFor) {
        entriesFor = new Set();
        undeclared.set(base, entriesFor);
      }
      entriesFor.add(name);
    }
  }
  // Bare side-effect imports (`import "pkg"`) in bundled source get dropped
  // by the sideEffects:false waiver unless listed in sideEffectImports. Scan
  // every first-party input so a new one fails the build here instead of the
  // side effect silently never running — an early cut of these bundles lost
  // workers.ts's env load (then `import "dotenv/config"`) exactly this way.
  for (const input of Object.keys(result.metafile.inputs)) {
    if (input.includes("node_modules/") || scannedSources.has(input)) continue;
    scannedSources.add(input);
    if (!/\.(ts|tsx|mts|cts|js|mjs|cjs)$/.test(input)) continue;
    const source = readFileSync(path.join(APP, input), "utf8");
    for (const m of source.matchAll(/^[ \t]*import\s*(["'])([^"'\n]+)\1/gm)) {
      const spec = m[2] ?? "";
      if (/^(\.|\/|~\/|@app\/|@ee\/)/.test(spec)) continue;
      if (spec.startsWith("node:") || builtins.has(basePackage(spec))) continue;
      if (sideEffectImports.has(spec)) continue;
      // Workspace packages are bundled, so their side effects survive.
      if (workspaceBundled.has(basePackage(spec))) continue;
      let files = unlistedSideEffectImports.get(spec);
      if (!files) {
        files = new Set();
        unlistedSideEffectImports.set(spec, files);
      }
      files.add(input);
    }
    // Dynamic imports of JSON from an external package. These survive into the
    // bundle verbatim, so Node resolves them through the ESM loader, which
    // rejects JSON without an import attribute (ERR_IMPORT_ATTRIBUTE_MISSING).
    // tsx absorbs the missing attribute, so this only ever breaks in
    // production, and it breaks quietly wherever the caller catches and
    // degrades — the tokenizer skipped tokenization entirely for exactly this
    // reason.
    for (const m of source.matchAll(
      /import\s*\(\s*(["'])([^"'\n]+\.json)\1\s*([,)])/g,
    )) {
      const spec = m[2] ?? "";
      // Relative JSON is bundled in, so the loader never sees it.
      if (/^(\.|\/|~\/|@app\/|@ee\/)/.test(spec)) continue;
      // Only a literal `with: { type: "json" }` second argument satisfies the
      // loader. Anything else still throws at runtime: `{}`, an options
      // variable the scan can't see into, or `assert` (removed in Node 22).
      if (
        m[3] === "," &&
        /^\s*\{\s*with\s*:\s*\{\s*type\s*:\s*(["'])json\1/.test(
          source.slice((m.index ?? 0) + m[0].length),
        )
      )
        continue;
      let files = jsonImportsWithoutAttribute.get(spec);
      if (!files) {
        files = new Set();
        jsonImportsWithoutAttribute.set(spec, files);
      }
      files.add(input);
    }
  }
  if (emitMeta) {
    writeFileSync(
      path.join(OUT_DIR, `${name}.meta.json`),
      JSON.stringify(result.metafile),
    );
  }
  console.log(`  built dist/server/${name}.cjs`);
}

for (const [spec, files] of unlistedSideEffectImports) {
  console.error(
    `  error: bare side-effect import "${spec}" in ${[...files].join(", ")} would be dropped by sideEffects:false — add it to sideEffectImports in scripts/build-server.mjs`,
  );
}
if (undeclared.size > 0) {
  for (const [pkg, entries] of undeclared) {
    console.error(
      `  error: ${pkg} is required by ${[...entries].join(", ")} but not in dependencies`,
    );
  }
  console.error(
    "  The bundles resolve external requires from node_modules at runtime; a --prod install only ships `dependencies`. Declare the packages above in platform/app/package.json dependencies.",
  );
}
for (const [spec, files] of jsonImportsWithoutAttribute) {
  console.error(
    `  error: dynamic import of "${spec}" in ${[...files].join(", ")} lacks a literal \`with: { type: "json" }\` import attribute — Node's ESM loader rejects JSON without it (ERR_IMPORT_ATTRIBUTE_MISSING). Write: import("${spec}", { with: { type: "json" } })`,
  );
}
if (
  undeclared.size > 0 ||
  unlistedSideEffectImports.size > 0 ||
  jsonImportsWithoutAttribute.size > 0
) {
  process.exit(1);
}

// goose runs the .sql migrations from `${__dirname}/migrations`, which in the
// bundle is dist/server/migrations. Ship them there.
cpSync(
  path.join(APP, "src", "server", "clickhouse", "migrations"),
  path.join(OUT_DIR, "migrations"),
  { recursive: true },
);
console.log("  copied clickhouse migrations -> dist/server/migrations");
