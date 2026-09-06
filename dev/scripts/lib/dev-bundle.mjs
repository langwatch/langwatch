/**
 * Rebuilds one dev entrypoint (apps/api's or apps/worker's) into a plain CJS
 * bundle that `node` runs directly — no per-restart TypeScript transform.
 *
 * `tsx watch` re-transforms the WHOLE loaded graph on every restart (the api
 * graph alone is thousands of files), so every debounced restart paid that
 * cost again. Production already solved this for the scenario child process
 * (apps/worker/scripts/build-server.mjs): bundle once, inline first-party and
 * workspace source, keep external only what resolves a real file relative to
 * its own location or patches `require` itself. This module is that same
 * shape, generalised so both apps/api and apps/worker's DEV loop can reuse it
 * without two copies — the shared piece dev-supervisor.mjs's `--watch` mode
 * calls after each debounced change, before it restarts anything.
 *
 * esbuild itself is borrowed from apps/worker's own `node_modules` (its
 * existing devDependency, used by build-server.mjs) via `createRequire`
 * rather than `import "esbuild"`, so this file resolves regardless of which
 * app calls it and neither app needs a second copy of the dependency.
 */

import { readFileSync } from "node:fs";
import { builtinModules, createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { OPTIONAL_EXTERNALS } from "../../../apps/worker/scripts/bundle-optional-externals.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/**
 * Guarded-optional native bindings some inlined library tries to `require`
 * behind a try/catch and falls back without — the same class production's
 * own OPTIONAL_EXTERNALS (apps/worker/scripts/bundle-optional-externals.mjs)
 * exists for, extended with the two native drivers `pg` and the MongoDB
 * client probe for opportunistically: never declared as a dependency on
 * purpose, and their absence is handled by the code that requires them.
 */
const DEV_BUNDLE_ADDITIONAL_OPTIONAL = Object.freeze(["pg-native", "kerberos"]);

/**
 * Loaded lazily, on the first actual build, not at module load: this file is
 * imported by dev-supervisor.mjs unconditionally (every `--watch` run, and
 * every plain stack-lifecycle run that never bundles anything), and a
 * missing `esbuild` must only break the apps that call `buildDevBundle`, not
 * every other dev-supervisor invocation on the machine.
 */
function requireEsbuild() {
  return createRequire(path.join(REPO_ROOT, "apps/worker/package.json"))("esbuild");
}

/**
 * Packages that resolve a real file relative to their OWN location, or patch
 * `require` globally — inlining moves the former and breaks the latter.
 * Mirrors apps/worker/scripts/build-server.mjs's NEVER_INLINED exactly; kept
 * here rather than imported from there because reading a script meant to be
 * *run*, not imported, is the wrong direction for a shared dependency.
 */
const NEVER_INLINED = [
  /^@opentelemetry\//,
  /^@prisma\//,
  /^\.prisma(\/|$)/,
  /^pino(-|$)/,
  /^thread-stream$/,
];

function basePackage(id) {
  const parts = id.split("/");
  return id.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? id);
}

/** The workspace packages `appDir`'s package.json names — always inlined, since they ship raw TypeScript. */
function workspaceBundledNames(appDir) {
  const pkg = JSON.parse(readFileSync(path.join(appDir, "package.json"), "utf8"));
  return new Set(
    Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })
      .filter(([, spec]) => typeof spec === "string" && spec.startsWith("workspace:"))
      .map(([name]) => name),
  );
}

function isInlined(id, workspaceBundled) {
  if (/^(\.\.?\/|\/|#)/.test(id)) return true;
  if (workspaceBundled.has(basePackage(id))) return true;
  return !NEVER_INLINED.some((re) => re.test(id));
}

function externalizePlugin(workspaceBundled) {
  return {
    name: "externalize",
    setup(b) {
      b.onResolve({ filter: /.*/ }, (args) => {
        if (isInlined(args.path, workspaceBundled)) return;
        return { path: args.path, external: true, sideEffects: false };
      });
    },
  };
}

/** esbuild's structured build errors, one line per diagnostic, file:line included when esbuild has it. */
function formatEsbuildErrors(err) {
  if (Array.isArray(err?.errors) && err.errors.length > 0) {
    return err.errors.map((e) => {
      const at = e.location ? ` (${e.location.file}:${e.location.line})` : "";
      return `${e.text}${at}`;
    });
  }
  return [String(err?.message ?? err)];
}

/**
 * Builds `entry` (relative to `appDir`) into `outfile`. A failed build leaves
 * whatever bundle is already on disk untouched — esbuild only writes output
 * once a build succeeds — so the caller's decision to keep the previous
 * process running on failure needs no extra bookkeeping here.
 *
 * @param {{ appDir: string, entry: string, outfile: string }} options
 * @returns {Promise<{ ok: true } | { ok: false, errors: string[] }>}
 */
function builtinBasePackages() {
  return new Set(builtinModules);
}

/**
 * A package required by the bundled (inlined) source but left external
 * because it is `NEVER_INLINED`, and not declared in `appDir`'s own
 * `dependencies` — the class of bug production's build-server.mjs's
 * `undeclared` check exists to catch: inlining moves the require from the
 * workspace package that actually resolves it (its own `node_modules`) to
 * the app's bundle, so at runtime it resolves from the APP's `node_modules`
 * instead. A missing entry there is a silent MODULE_NOT_FOUND at boot, not a
 * build failure, unless this catches it first.
 */
function findUndeclaredExternals({ appDir, metafile, workspaceBundled, builtins }) {
  const declared = new Set(Object.keys(readAppPkg(appDir).dependencies ?? {}));
  const optional = new Set([...OPTIONAL_EXTERNALS, ...DEV_BUNDLE_ADDITIONAL_OPTIONAL]);
  const undeclared = new Set();
  for (const output of Object.values(metafile.outputs)) {
    for (const imported of output.imports) {
      if (!imported.external) continue;
      const id = imported.path;
      if (id.startsWith("node:") || builtins.has(basePackage(id))) continue;
      if (id === ".prisma" || id.startsWith(".prisma/")) continue;
      const base = basePackage(id);
      if (declared.has(base) || workspaceBundled.has(base) || optional.has(base)) continue;
      undeclared.add(base);
    }
  }
  return undeclared;
}

function readAppPkg(appDir) {
  return JSON.parse(readFileSync(path.join(appDir, "package.json"), "utf8"));
}

export async function buildDevBundle({ appDir, entry, outfile }) {
  const workspaceBundled = workspaceBundledNames(appDir);
  try {
    const { build } = requireEsbuild();
    const result = await build({
      entryPoints: [path.join(appDir, entry)],
      outfile,
      absWorkingDir: appDir,
      tsconfig: path.join(appDir, "tsconfig.json"),
      bundle: true,
      platform: "node",
      format: "cjs",
      target: "node24",
      jsx: "automatic",
      // CJS has no `import.meta`; point it at the bundle's own directory URL,
      // same shim build-server.mjs uses, so `import.meta.url`-based path
      // resolution in application code still works.
      banner: {
        js: 'const importMetaUrl = require("url").pathToFileURL(__dirname).href + "/";',
      },
      define: {
        "import.meta.url": "importMetaUrl",
        // NOTE: this is WRONG for any inlined module that uses
        // import.meta.dirname to locate a SIBLING FILE ON DISK at runtime
        // (e.g. packages/clickhouse-client's goose migration runner finding
        // its migrations/ directory) — inlining already moved that file's
        // logical location to the bundle's own directory, and __dirname
        // reflects the bundle, not the original source file. Kept only so a
        // build does not hard-crash on the reference; see the module
        // docblock's "known gaps" note.
        "import.meta.dirname": "__dirname",
        "import.meta.env.DEV": "true",
        "import.meta.env.PROD": "false",
        "import.meta.env": "{}",
      },
      mainFields: ["module", "main"],
      conditions: ["import"],
      plugins: [externalizePlugin(workspaceBundled)],
      // Linked source maps: dev stack traces still name real src files/lines,
      // not bundle offsets.
      sourcemap: "linked",
      sourcesContent: false,
      metafile: true,
      logLevel: "silent",
    });
    const undeclared = findUndeclaredExternals({
      appDir,
      metafile: result.metafile,
      workspaceBundled,
      builtins: builtinBasePackages(),
    });
    if (undeclared.size > 0) {
      return {
        ok: false,
        errors: [...undeclared.keys()].map(
          (pkg) =>
            `"${pkg}" is required by a bundled workspace package but not declared in ${path.basename(appDir)}'s dependencies`,
        ),
      };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, errors: formatEsbuildErrors(err) };
  }
}
