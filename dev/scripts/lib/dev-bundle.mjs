/**
 * Rebuilds one dev entrypoint into a plain CJS bundle so `node` runs it
 * directly, instead of `tsx watch` re-transforming the whole graph on every
 * restart — generalising production's own build-server.mjs approach.
 */

import { readFileSync } from "node:fs";
import { builtinModules, createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { OPTIONAL_EXTERNALS } from "@langwatch/scenario-child/bundle-optional-externals";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/**
 * Guarded-optional native bindings, same class as production's
 * OPTIONAL_EXTERNALS — never declared as a dependency on purpose, since
 * their absence is handled by the code that requires them.
 */
const DEV_BUNDLE_ADDITIONAL_OPTIONAL = Object.freeze(["pg-native", "kerberos"]);

/**
 * Loaded lazily, on the first actual build, not at module load: a missing
 * `esbuild` must only break callers of `buildDevBundle`, not every
 * dev-supervisor invocation that imports this file unconditionally.
 */
function requireEsbuild() {
  return createRequire(path.join(REPO_ROOT, "apps/worker/package.json"))("esbuild");
}

/**
 * Packages that resolve a file relative to their OWN location, or patch
 * `require` globally — inlining moves the former and breaks the latter.
 * Mirrors build-server.mjs's NEVER_INLINED, duplicated rather than imported.
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

/**
 * The workspace packages `appDir`'s package.json names — always inlined,
 * since they ship raw TypeScript.
 */
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
  const base = basePackage(id);
  if (workspaceBundled.has(base)) return true;
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

/**
 * esbuild's structured build errors, one line per diagnostic, file:line
 * included when esbuild has it.
 */
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
 * Builds `entry` into `outfile`. A failed build leaves the previous bundle
 * on disk untouched — esbuild only writes output once a build succeeds.
 * @param {{ appDir: string, entry: string, outfile: string }} options
 * @returns {Promise<{ ok: true } | { ok: false, errors: string[] }>}
 */
function builtinBasePackages() {
  return new Set(builtinModules);
}

/**
 * A package required by inlined source but left external and not declared
 * in `appDir`'s own deps: a missing entry is a silent MODULE_NOT_FOUND at
 * boot, not a build failure — unless this catches it.
 */
function findUndeclaredExternals({ appDir, metafile, workspaceBundled, builtins }) {
  const declared = new Set(Object.keys(readAppPkg(appDir).dependencies ?? {}));
  const optional = new Set([...OPTIONAL_EXTERNALS, ...DEV_BUNDLE_ADDITIONAL_OPTIONAL]);
  const undeclared = new Set();
  for (const output of Object.values(metafile.outputs)) {
    for (const imported of output.imports) {
      if (!imported.external) continue;
      const id = imported.path;
      const base = basePackage(id);
      if (id.startsWith("node:")) continue;
      if (builtins.has(base)) continue;
      if (id === ".prisma" || id.startsWith(".prisma/")) continue;
      if (declared.has(base)) continue;
      if (workspaceBundled.has(base)) continue;
      if (optional.has(base)) continue;
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
        // NOTE: WRONG for an inlined module using import.meta.dirname to
        // find a SIBLING FILE ON DISK at runtime (e.g. the clickhouse-client
        // goose migration runner's migrations/ dir) — __dirname here means
        // the bundle's directory, not the original source. Kept only so the
        // build doesn't hard-crash on the reference.
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
