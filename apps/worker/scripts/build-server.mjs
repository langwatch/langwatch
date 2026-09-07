/**
 * Bundles the scenario child into `dist/server/scenario-child-process.cjs`, so a
 * simulation spawns plain `node` on one file rather than `pnpm exec tsx`.
 * @see specs/scenarios/pre-compiled-child-process.feature
 */

/*
 * The child is a FRESH process per run, so what it resolves from disk at boot is
 * paid once per simulation. Hence inlining the whole graph, SDK included: left
 * external, requiring it walks the pnpm symlink tree on every spawn.
 */

/*
 * Everything still required externally must be declared in this application's
 * `dependencies`: pnpm gives it no transitive packages and `--prod` drops
 * devDependencies. The check below says so here, not at boot in the image.
 */

import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { builtinModules } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { OPTIONAL_EXTERNALS } from "./bundle-optional-externals.mjs";

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(APP, "dist", "server");

/** @type {{ dependencies?: Record<string, string>, devDependencies?: Record<string, string> }} */
const appPkg = JSON.parse(readFileSync(path.join(APP, "package.json"), "utf8"));

/**
 * The workspace packages this application names. They ship raw TypeScript, so
 * only bundling resolves them and they are always inlined. The scan below reads
 * this set to tell a bundled import (side effects survive) from an external one.
 */
const workspaceBundled = new Set(
  Object.entries({ ...appPkg.dependencies, ...appPkg.devDependencies })
    .filter(([, spec]) => typeof spec === "string" && spec.startsWith("workspace:"))
    .map(([name]) => name),
);

/**
 * Modules imported solely for their side effects (`import "pkg"`). The
 * `sideEffects:false` waiver below would DROP these, so they stay external
 * without it; the source scan fails on any bare side-effect import missing here.
 */
const sideEffectImports = new Set();

/**
 * The bare package a specifier belongs to: `tiktoken/lite` -> `tiktoken`,
 * `@grpc/grpc-js/foo` -> `@grpc/grpc-js`.
 * @param {string} id @returns {string}
 */
const basePackage = (id) => {
  const parts = id.split("/");
  return id.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? id);
};

/*
 * Kept external though this entry inlines the rest. @opentelemetry/*: the child
 * flushes through the GLOBALLY registered provider, and a second inlined copy
 * splits registration from flush, dropping every span. @prisma/*: native.
 */

/*
 * pino / thread-stream start their transport on a worker thread whose script
 * they find at `join(__dirname, "worker.js")`. Inlined, that lookup misses and
 * thread-stream rethrows on nextTick — uncaught, and the child dies.
 */

/*
 * The rule for adding here: a package that resolves a FILE at runtime relative
 * to its own location cannot be inlined, because inlining moves that location.
 */
const NEVER_INLINED = [
  /^@opentelemetry\//,
  /^@prisma\//,
  /^\.prisma(\/|$)/,
  /^pino(-|$)/,
  /^thread-stream$/,
];

/**
 * Whether a specifier gets inlined. First-party source and workspace packages
 * always are; this entry takes everything else with it except NEVER_INLINED.
 * @param {string} id @returns {boolean}
 */
const isInlined = (id) => {
  if (/^(\.\.?\/|\/|#)/.test(id)) return true;
  const isWorkspacePackage = workspaceBundled.has(basePackage(id));
  if (isWorkspacePackage) return true;
  const isNeverInlined = NEVER_INLINED.some((re) => re.test(id));
  return !isNeverInlined;
};

/** @returns {import("esbuild").Plugin} */
const externalize = () => ({
  name: "externalize",
  setup(b) {
    b.onResolve({ filter: /.*/ }, (a) => {
      if (isInlined(a.path)) return;
      if (sideEffectImports.has(a.path)) {
        return { path: a.path, external: true };
      }
      return { path: a.path, external: true, sideEffects: false };
    });
  },
});

// CommonJS output. CJS is deliberate: `__dirname`/`__filename`/`require` are
// native, and OTel's require-in-the-middle patches the external
// instrumentation targets, which CJS requires go through.

// CJS has no `import.meta`, so esbuild would leave `import.meta.url` empty.
// Point it at the bundle's own DIRECTORY URL — the directory `__dirname` is.
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
  {
    // Spawned per scenario run by `child-process-spawn.adapter.ts`, as a fresh
    // process every time.
    name: "scenario-child-process",
    entry: "src/scenario-child.entrypoint.ts",
  },
];

rmSync(OUT_DIR, { recursive: true, force: true });

const emitMeta = process.env.EMIT_META === "1";
const declared = new Set(Object.keys(appPkg.dependencies ?? {}));
const builtins = new Set(builtinModules);
const optionalExternals = new Set(OPTIONAL_EXTERNALS);
/** @type {Map<string, Set<string>>} package -> entry names that require it */
const undeclared = new Map();
const scannedSources = new Set();
/** @type {Map<string, Set<string>>} specifier -> source files that bare-import it */
const unlistedSideEffectImports = new Map();

for (const { name, entry } of ENTRIES) {
  const result = await build({
    entryPoints: [path.join(APP, entry)],
    outfile: path.join(OUT_DIR, `${name}.cjs`),
    absWorkingDir: APP,
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
    // entry is opaque, so every branch of it would be kept.
    mainFields: ["module", "main"],
    conditions: ["import"],
    plugins: [externalize()],
    metafile: true,
    // Linked source maps so production stack traces name real files and lines
    // instead of bundle offsets. `sourcesContent: false` keeps the source text
    // out of the shipped map.
    sourcemap: "linked",
    sourcesContent: false,
    logLevel: "info",
    logLimit: 0,
  });

  for (const output of Object.values(result.metafile.outputs)) {
    for (const imported of output.imports) {
      if (!imported.external) continue;
      const id = imported.path;
      const isBuiltin = id.startsWith("node:") || builtins.has(basePackage(id));
      if (isBuiltin) continue;
      if (id === ".prisma" || id.startsWith(".prisma/")) continue;
      const base = basePackage(id);
      if (declared.has(base)) continue;
      if (optionalExternals.has(base)) continue;
      let entriesFor = undeclared.get(base);
      if (!entriesFor) {
        entriesFor = new Set();
        undeclared.set(base, entriesFor);
      }
      entriesFor.add(name);
    }
  }

  // Bare side-effect imports (`import "pkg"`) in bundled source get dropped by
  // the sideEffects:false waiver unless listed above, so a new one fails the
  // build here instead of the side effect silently never running.
  for (const input of Object.keys(result.metafile.inputs)) {
    const isAlreadyScanned = input.includes("node_modules/") || scannedSources.has(input);
    if (isAlreadyScanned) continue;
    scannedSources.add(input);
    if (!/\.(ts|tsx|mts|cts|js|mjs|cjs)$/.test(input)) continue;
    const source = readFileSync(path.join(APP, input), "utf8");
    for (const m of source.matchAll(/^[ \t]*import\s*(["'])([^"'\n]+)\1/gm)) {
      const spec = m[2] ?? "";
      if (/^(\.|\/|#)/.test(spec)) continue;
      const isSpecBuiltin = spec.startsWith("node:") || builtins.has(basePackage(spec));
      if (isSpecBuiltin) continue;
      if (sideEffectImports.has(spec)) continue;
      const isWorkspaceBundled = workspaceBundled.has(basePackage(spec));
      if (isWorkspaceBundled) continue;
      let files = unlistedSideEffectImports.get(spec);
      if (!files) {
        files = new Set();
        unlistedSideEffectImports.set(spec, files);
      }
      files.add(input);
    }
  }

  if (emitMeta) {
    writeFileSync(path.join(OUT_DIR, `${name}.meta.json`), JSON.stringify(result.metafile));
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
    "  The bundle resolves external requires from node_modules at runtime; a --prod install only ships `dependencies`. Declare the packages above in apps/worker/package.json dependencies.",
  );
}
if (undeclared.size > 0 || unlistedSideEffectImports.size > 0) {
  process.exit(1);
}
