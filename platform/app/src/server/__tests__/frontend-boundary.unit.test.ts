/**
 * @vitest-environment node
 *
 * @see specs/setup/memory-footprint.feature — "Server code cannot reach
 * browser-only UI, even transitively"
 *
 * An architectural guard, not a snapshot. It walks the real import graph the
 * way Node does and fails with the offending chain.
 *
 * It has to be transitive, because the leak it prevents was invisible to a
 * direct-import check: `routes/evaluations-legacy.ts` imported one display-name
 * constant from a React component, and that single hop pulled Chakra UI, Ark
 * UI, Emotion, react-dom and react-router — ~1,320 modules of browser-only code
 * — into the API, worker, and ingestion processes alike.
 *
 * Only *value* imports are followed: `import type` is erased at compile time
 * and cannot pull a module at runtime, so a server file may freely name a
 * component's types.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
/** `platform/app/` — parent of `src/` and of the `ee/` tree. */
const APP_ROOT = path.resolve(SRC, "..");
/** Repo root — where the `packages/*` workspace tree lives (ADR-076). */
const REPO_ROOT = path.resolve(APP_ROOT, "../..");

/**
 * Packages that only make sense in a browser. Prefix-matched on the specifier.
 *
 * The OpenTelemetry entries are deliberately narrow. Most of `@opentelemetry/*`
 * is isomorphic and the server legitimately depends on it (`api`, `core`,
 * `resources`, `sdk-trace-base`, `semantic-conventions`, the OTLP exporters);
 * only these three are browser-bound — a `WebTracerProvider`, and
 * instrumentation for the DOM and `window.fetch`. Banning the scope wholesale
 * would make this guard unusable; leaving the scope out entirely is what let
 * the `@langwatch/react-rum` barrel reach three backend files unnoticed.
 */
const BROWSER_ONLY = [
  "react",
  "react-dom",
  "react-router",
  "react-feather",
  "lucide-react",
  "framer-motion",
  "@chakra-ui",
  "@ark-ui",
  "@emotion",
  "@zag-js",
  "@opentelemetry/sdk-trace-web",
  "@opentelemetry/instrumentation-document-load",
  "@opentelemetry/instrumentation-fetch",
];

/**
 * Server-rendered email templates are React by design (react-email renders them
 * to HTML at send time), so React is legitimate there and nowhere else. They are
 * allowed *terminals*: the walk stops on entry, so a service that sends mail is
 * not reported for the React its templates legitimately use.
 */
const ALLOWED_PREFIXES = ["server/mailer/"];

const isAllowedTerminal = (file: string) =>
  ALLOWED_PREFIXES.some((p) => rel(file).startsWith(p));

/** Backend trees: nothing under these may reach a browser-only package. */
const BACKEND_TREES = [
  "server",
  path.join("app", "api"),
  path.join("pages", "api"),
  "mcp",
  "tasks",
];

/**
 * The process entrypoints. They are single files rather than trees, and they
 * matter more than anything under them: whatever they reach is, by definition,
 * resident in a running backend process. `server.mts` also proves why
 * `isSource` has to accept `.mts` — the boot file of the API process is not a
 * `.ts` file at all.
 */
const BACKEND_ENTRYPOINTS = ["server.mts", "start.ts", "workers.ts"];

const rel = (file: string) =>
  path.relative(SRC, file).split(path.sep).join("/");

const isSource = (f: string) =>
  /\.(?:mts|cts|tsx?)$/.test(f) &&
  !/\.d\.(?:mts|cts|ts)$/.test(f) &&
  !/\.(test|spec)\.(?:mts|cts|tsx?)$/.test(f) &&
  !f.includes(`${path.sep}__tests__${path.sep}`) &&
  !f.includes(`${path.sep}__mocks__${path.sep}`);

const walk = (dir: string, out: string[] = []): string[] => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (isSource(full)) out.push(full);
  }
  return out;
};

const contents = new Map<string, string>();
const read = (file: string): string => {
  let c = contents.get(file);
  if (c === undefined) {
    c = fs.readFileSync(file, "utf8");
    contents.set(file, c);
  }
  return c;
};

/**
 * Specifiers this file imports for their *runtime value*. `import type {...}`
 * and `export type {...}` are skipped; inline `{ type A, b }` still counts,
 * because `b` is a value.
 */
const importCache = new Map<string, string[]>();

const valueImportsOf = (file: string): string[] => {
  const memoized = importCache.get(file);
  if (memoized !== undefined) return memoized;

  const specs = parseValueImports(file);
  importCache.set(file, specs);
  return specs;
};

/** Side-effect imports: `import "x"`. Always a runtime edge. */
const sideEffectImports = (source: string): string[] => {
  const specs: string[] = [];
  for (const [, spec] of source.matchAll(
    /(?:^|\n)\s*import\s+["']([^"']+)["']/g,
  )) {
    if (spec) specs.push(spec);
  }
  return specs;
};

/** Bound imports/re-exports: `import ... from "x"` / `export ... from "x"`. */
const boundImports = (source: string): string[] => {
  const specs: string[] = [];
  for (const [, clause, spec] of source.matchAll(
    /(?:^|\n)\s*(?:import|export)\s+([^;'"]*?)\s*from\s*["']([^"']+)["']/g,
  )) {
    if (!spec) continue;
    if (clause && /^type\s/.test(clause.trim())) continue; // erased at compile time
    specs.push(spec);
  }
  return specs;
};

/**
 * Dynamic `import("x")` in value position.
 *
 * This matters more here than anywhere else: deferring a heavy dependency behind
 * `await import()` is precisely the technique used to keep it out of the boot
 * graph, so a guard blind to it would bless the one move most likely to smuggle
 * the UI stack back in at runtime.
 *
 * Two forms are TYPES, erased at compile time, and following them would report
 * leaks that do not exist: `typeof import("x")`, and the type-query member
 * access `import("x").Foo` (as in `import("~/generated/prisma/client").PrismaClient`).
 * `(await import("x")).foo` puts a paren between the specifier and the dot, so
 * it survives the member-access filter. `import("x").then(...)` is skipped along
 * with them — that under-reports rather than over-reports, which is the safe
 * direction for a guard.
 */
const dynamicImports = (source: string): string[] => {
  const specs: string[] = [];
  for (const [, typeQuery, spec, next] of source.matchAll(
    /(typeof\s+)?import\(\s*["']([^"']+)["']\s*\)(.?)/g,
  )) {
    if (!spec || typeQuery || next === ".") continue;
    specs.push(spec);
  }
  return specs;
};

const parseValueImports = (file: string): string[] => {
  const source = read(file);
  return [
    ...sideEffectImports(source),
    ...boundImports(source),
    ...dynamicImports(source),
  ];
};

const CANDIDATE_SUFFIXES = [
  "",
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  "/index.ts",
  "/index.tsx",
];

const fileAt = (base: string): string | null => {
  // ESM-style ".js" specifiers point at TypeScript sources on disk.
  const withoutJs = base.replace(/\.js$/, "");
  for (const candidate of [base, withoutJs]) {
    for (const suffix of CANDIDATE_SUFFIXES) {
      const full = candidate + suffix;
      if (fs.existsSync(full) && fs.statSync(full).isFile()) return full;
    }
  }
  return null;
};

/** tsconfig `paths` / vite `resolve.alias`, which the walk must mirror. */
const PATH_ALIASES: [prefix: string, target: string][] = [
  ["~/", SRC],
  ["@app/", path.join(SRC, "server", "app-layer")],
  ["@ee/", path.join(APP_ROOT, "ee")],
];

/** The file a package manifest points one subpath at, via `exports` or `main`. */
const manifestTarget = (manifest: string, subpath: string): string | null => {
  const pkg = JSON.parse(read(manifest)) as {
    main?: string;
    exports?: Record<string, unknown>;
  };
  const entry = pkg.exports?.[subpath] ?? (subpath === "." ? pkg.main : null);
  if (typeof entry === "string") return entry;
  // Conditional exports ({ import, default, ... }) resolve to their default.
  const conditional = (entry as { default?: string } | null)?.default;
  return typeof conditional === "string" ? conditional : null;
};

/**
 * A workspace package (`@langwatch/*`) resolved through its own `exports` map.
 *
 * Honouring `exports` is the point, not pedantry: a package's barrel and its
 * leaf modules are different reachability stories. `@langwatch/react-rum`
 * re-exports `startBrowserTracing` (→ `@opentelemetry/sdk-trace-web`) from its
 * root, while `@langwatch/react-rum/constants` is plain strings and numbers.
 * Resolving every subpath to the barrel would report the safe import as a leak;
 * ignoring workspace packages entirely — as this guard first did — let a real
 * one through.
 */
const resolveWorkspacePackage = (spec: string): string | null => {
  if (!spec.startsWith("@langwatch/")) return null;
  const [, name, ...rest] = spec.split("/");
  if (!name) return null;
  const subpath = rest.length > 0 ? `./${rest.join("/")}` : ".";

  for (const root of [APP_ROOT, REPO_ROOT]) {
    const pkgDir = path.join(root, "packages", name);
    const manifest = path.join(pkgDir, "package.json");
    if (!fs.existsSync(manifest)) continue;

    const target = manifestTarget(manifest, subpath);
    if (!target) continue;

    const resolved = fileAt(path.resolve(pkgDir, target));
    if (resolved) return resolved;
  }
  return null;
};

const resolveUncached = (spec: string, fromFile: string): string | null => {
  for (const [prefix, target] of PATH_ALIASES) {
    if (spec.startsWith(prefix)) {
      return fileAt(path.join(target, spec.slice(prefix.length)));
    }
  }
  if (spec.startsWith(".")) {
    return fileAt(path.resolve(path.dirname(fromFile), spec));
  }
  // Workspace packages are source-linked, so their graph is ours to walk.
  return resolveWorkspacePackage(spec);
};

/**
 * Resolutions are cached, and that is load-bearing rather than a nicety. A miss
 * costs a fistful of `statSync` calls (every candidate extension, twice), and
 * popular specifiers are re-asked from hundreds of importers. Uncached, the
 * walk took ~35s on a CI runner and tripped the 30s test timeout — a guard that
 * times out reports nothing at all, which looks far too much like passing.
 *
 * Only relative specifiers depend on where they were written; alias and
 * workspace specifiers resolve identically from anywhere, so they share one
 * entry instead of one per importing directory.
 */
const resolutions = new Map<string, string | null>();

/** Resolve an app-internal specifier to a file, or null if it is a package. */
const resolveAppImport = (spec: string, fromFile: string): string | null => {
  // "\0" cannot occur in a path or a specifier, so it separates the two
  // halves of the key unambiguously. Written as an escape rather than a
  // literal NUL, which would make this source file binary to git.
  const key = spec.startsWith(".")
    ? `${path.dirname(fromFile)}\0${spec}`
    : spec;

  const cached = resolutions.get(key);
  if (cached !== undefined) return cached;

  const resolved = resolveUncached(spec, fromFile);
  resolutions.set(key, resolved);
  return resolved;
};

const bannedPackage = (spec: string): string | null =>
  BROWSER_ONLY.find((p) => spec === p || spec.startsWith(`${p}/`)) ?? null;

/**
 * Whether this file actually renders JSX, and therefore imports
 * `react/jsx-runtime` at runtime.
 *
 * Under `jsx: "react-jsx"` that import is *emitted by the compiler* — it appears
 * nowhere in the source, so no amount of parsing specifiers will ever find it.
 * The 37 files under `components/icons/` contain literally no import statement
 * at all, yet each one loads React. Without this rule they look inert, and
 * server code importing one would pull the UI stack into every backend process
 * with the guard still green — precisely the leaf class the leak this guard
 * exists to prevent travelled through.
 *
 * The extension alone is not the signal: `server/modelProviders/llmModelCost.tsx`
 * and `features/onboarding/.../registry.tsx` are `.tsx` files with no JSX in
 * them, so nothing is emitted and flagging them would be a false positive. Every
 * real JSX element has to close, either `</tag>` or `/>`, so requiring one of
 * those keeps the rule to files that genuinely render. A `</` inside a string or
 * comment could over-report; none does today, and the failure direction of a
 * miss is a silent hole, so the check is deliberately the cheap one.
 */
const rendersJsx = (file: string): boolean =>
  /\.[jt]sx$/.test(file) && /<\/|\/>/.test(read(file));

/**
 * The app-internal imports of one file, recording in `directHit` the first
 * browser-only package the file imports itself.
 */
const edgesOf = (file: string, directHit: Map<string, string>): string[] => {
  const kids: string[] = [];
  for (const spec of valueImportsOf(file)) {
    const banned = bannedPackage(spec);
    if (banned) {
      if (!directHit.has(file)) directHit.set(file, banned);
      continue;
    }
    const target = resolveAppImport(spec, file);
    if (target && !isAllowedTerminal(target)) kids.push(target);
  }
  return kids;
};

/** Forward walk from `roots`, collecting the import edges and the direct hits. */
const walkImportGraph = (roots: string[]) => {
  const children = new Map<string, string[]>();
  const directHit = new Map<string, string>();
  const seen = new Set<string>(roots);
  const queue = [...roots];

  while (queue.length > 0) {
    const file = queue.pop()!;
    const kids = edgesOf(file, directHit);
    // After `edgesOf`, so an explicit browser-package import stays the reported
    // cause; the emitted JSX runtime is the fallback for files that have none.
    if (!directHit.has(file) && rendersJsx(file)) {
      directHit.set(file, "react/jsx-runtime");
    }
    children.set(file, kids);
    for (const kid of kids) {
      if (seen.has(kid)) continue;
      seen.add(kid);
      queue.push(kid);
    }
  }
  return { children, directHit };
};

/** Reverse the edges, so taint can flood from importee back to importer. */
const invertEdges = (
  children: Map<string, string[]>,
): Map<string, string[]> => {
  const parents = new Map<string, string[]>();
  for (const [file, kids] of children) {
    for (const kid of kids) {
      const known = parents.get(kid);
      if (known) known.push(file);
      else parents.set(kid, [file]);
    }
  }
  return parents;
};

/**
 * Maps a tainted file to the child it reaches the package through, or null when
 * it imports one itself. Seeded with the direct importers and flooded
 * backwards, so each file is settled exactly once.
 */
const floodTaint = (
  directHit: Map<string, string>,
  parents: Map<string, string[]>,
): Map<string, string | null> => {
  const via = new Map<string, string | null>();
  const work: string[] = [];
  for (const file of directHit.keys()) {
    via.set(file, null);
    work.push(file);
  }
  while (work.length > 0) {
    const node = work.pop()!;
    for (const parent of parents.get(node) ?? []) {
      if (via.has(parent)) continue;
      via.set(parent, node);
      work.push(parent);
    }
  }
  return via;
};

/** Walk `via` from one root down to the browser-only package it ends at. */
const chainFrom = (
  root: string,
  via: Map<string, string | null>,
  directHit: Map<string, string>,
): string[] => {
  const chain: string[] = [];
  const guard = new Set<string>();
  let cursor: string | undefined = root;
  while (cursor !== undefined && !guard.has(cursor)) {
    guard.add(cursor);
    chain.push(rel(cursor));
    const next = via.get(cursor);
    if (next == null) {
      chain.push(directHit.get(cursor)!);
      break;
    }
    cursor = next;
  }
  return chain;
};

/**
 * Chains from each of `roots` to a browser-only package, computed as a fixed
 * point rather than by recursive descent.
 *
 * Recursion has to cut import cycles, and this codebase has them (see ADR-070
 * on `app-layer` ↔ `event-sourcing`). A "cannot reach" answer computed under a
 * cut cycle is not sound, so it cannot be cached — which means it gets
 * recomputed from every path that reaches it, and the walk degrades sharply as
 * the graph grows. That is not hypothetical: once this guard learned to resolve
 * the `@ee` alias and workspace packages, the recursive form took ~35s on a CI
 * runner and hit the 30s test timeout. A timed-out guard reports nothing, which
 * is indistinguishable from finding nothing.
 *
 * Propagating backwards from the files that import a browser-only package makes
 * cycles a non-event — a cycle yields a chain only if something inside it does —
 * and settles every node exactly once, in O(files + imports).
 */
const chainsToBrowserUi = (roots: string[]): Map<string, string[]> => {
  const { children, directHit } = walkImportGraph(roots);
  const via = floodTaint(directHit, invertEdges(children));

  const chains = new Map<string, string[]>();
  for (const root of roots) {
    if (via.has(root)) chains.set(root, chainFrom(root, via, directHit));
  }
  return chains;
};

/** Single-file form, for the self-validation cases below. */
const chainToBrowserUi = (file: string): string[] | null =>
  chainsToBrowserUi([file]).get(file) ?? null;

const backendFiles = [
  ...BACKEND_TREES.flatMap((tree) => {
    const dir = path.join(SRC, tree);
    return fs.existsSync(dir) ? walk(dir) : [];
  }),
  ...BACKEND_ENTRYPOINTS.map((f) => path.join(SRC, f)).filter((f) =>
    fs.existsSync(f),
  ),
];

describe("browser-only UI never reaches the backend", () => {
  describe("given the import graph rooted at every backend source file", () => {
    /** @scenario "Server code cannot reach browser-only UI, even transitively" */
    it("finds no chain from server code into a browser-only package", () => {
      const roots = backendFiles.filter((f) => !isAllowedTerminal(f));
      const violations = [...chainsToBrowserUi(roots).values()].map((chain) =>
        chain.join("\n     -> "),
      );

      expect(violations).toEqual([]);
    });
  });

  // Without this, a regex that silently stopped matching would make the guard
  // above pass vacuously.
  describe("given a component that genuinely renders Chakra", () => {
    it("still reports a chain, proving the walker resolves imports", () => {
      const component = path.join(
        SRC,
        "components/checks/EvaluatorSelection.tsx",
      );
      expect(fs.existsSync(component)).toBe(true);

      expect(chainToBrowserUi(component)).not.toBeNull();
    });
  });

  // Both halves are pinned, the same way the workspace-package cases below
  // are: the import has to still be there, AND still be excluded. Asserting
  // only the exclusion passes just as happily when the import is deleted —
  // which is exactly what happened when this case pointed at a component that
  // the legacy Traces removal took away with it.
  describe("given a type-only import of a component", () => {
    const server = path.join(
      SRC,
      "server/app-layer/reports/report-chart.service.ts",
    );
    const component = "~/components/analytics/CustomGraph";

    it("still makes that import, so the case has a subject", () => {
      expect(fs.readFileSync(server, "utf-8")).toContain(
        `import type { CustomGraphInput } from "${component}";`,
      );
    });

    it("does not count it, because types are erased", () => {
      expect(valueImportsOf(server)).not.toContain(component);
    });
  });

  // Workspace packages were invisible to the walk until `@langwatch/react-rum`
  // was found reaching three backend files. These two cases pin both halves of
  // the resolution: the barrel must still look dangerous, and the leaf must
  // still look safe. If the first stopped failing, the guard would be blind
  // again; if the second started failing, every safe import would be a false
  // positive and the guard would be ignored.
  describe("given a workspace package whose barrel re-exports browser tracing", () => {
    it("reports a chain through the barrel", () => {
      const barrel = resolveAppImport("@langwatch/react-rum", SRC);

      expect(barrel).not.toBeNull();
      expect(chainToBrowserUi(barrel!)).not.toBeNull();
    });

    it("reports none through its framework-free constants subpath", () => {
      const constants = resolveAppImport("@langwatch/react-rum/constants", SRC);

      expect(constants).not.toBeNull();
      expect(chainToBrowserUi(constants!)).toBeNull();
    });
  });

  // The compiler-emitted `react/jsx-runtime` import is the one edge that is in
  // no file's source. An icon component is the sharpest case: it has no import
  // statement whatsoever, so before this rule it was a dead end in the walk
  // rather than the React leaf it actually is.
  describe("given a component whose only React edge is the JSX runtime", () => {
    it("reports a chain, even with no import statement in the file", () => {
      const icon = path.join(SRC, "components/icons/OpenAI.tsx");
      expect(fs.existsSync(icon)).toBe(true);
      expect(read(icon)).not.toMatch(/^import/m);

      expect(chainToBrowserUi(icon)).not.toBeNull();
    });

    it("leaves a .tsx that renders nothing alone, so the rule is not the extension", () => {
      const noJsx = path.join(SRC, "server/modelProviders/llmModelCost.tsx");
      expect(fs.existsSync(noJsx)).toBe(true);

      expect(chainToBrowserUi(noJsx)).toBeNull();
    });
  });

  // Deferring a heavy dependency behind `await import()` is the technique that
  // keeps it out of the boot graph, so it is also the easiest way to smuggle the
  // UI stack back in. These two pin the value/type split: miss the first and the
  // walk has a hole, break the second and every `import("pkg").Type` annotation
  // becomes a false leak.
  describe("given a dynamic import", () => {
    it("follows one in value position, so a deferred require cannot hide", () => {
      const specs = valueImportsOf(
        path.join(SRC, "server/tracer/collector/piiCheck.ts"),
      );

      expect(specs).toContain("@google-cloud/dlp");
    });

    it("ignores one in type position, because the annotation is erased", () => {
      const specs = valueImportsOf(
        path.join(SRC, "server/api/routers/gatewayBudgets.ts"),
      );

      expect(specs).not.toContain("~/generated/prisma/client");
    });
  });
});

/**
 * The same boundary, walked the other way. A handful of `src/server/` modules
 * are imported by CLIENT code for their values — the rbac vocabulary
 * (`~/server/api/rbac`) supplies role helpers to `useOrganizationTeamProject`
 * and friends — so everything they pull at module scope lands in the browser
 * bundle and in every jsdom test graph. One import from rbac.ts into the authz
 * composition root put Prisma, redis and the EE audit writer into the client
 * graph: the t3-env client guard then throws at module load, which is a white
 * screen in the browser and eleven failed-to-load jsdom suites in CI. The env
 * guard only fires where env access is live, so no import probe can catch this
 * under test config — the graph itself is the invariant.
 */

/** Trees the browser bundle is built from. `pages/api` and `app/api` sit
 *  inside two of them and are backends, so they are cut out. */
const CLIENT_TREES: Array<{ dir: string; excludes?: string }> = [
  { dir: "components" },
  { dir: "hooks" },
  { dir: "features" },
  { dir: "utils" },
  { dir: "pages", excludes: path.join("pages", "api") },
  { dir: "app", excludes: path.join("app", "api") },
];

/**
 * Backend files that happen to live in a client tree, and are therefore not
 * in the bundle whatever their directory says. Both are `src/utils/`:
 * `testUtils` is imported only from test files, and `lambdaFetch` invokes AWS
 * Lambda for `server/nlpgo/nlpgoFetch.ts`, its single importer. Excusing the
 * two IMPORTERS rather than the server modules they reach keeps the guard
 * sharp: a genuine client file importing either of those modules still fails.
 */
const NOT_CLIENT_FILES = new Set(
  ["utils/testUtils.ts", "utils/lambdaFetch.ts"].map((p) => path.join(SRC, p)),
);

const clientFiles = CLIENT_TREES.flatMap(({ dir, excludes }) => {
  const full = path.join(SRC, dir);
  if (!fs.existsSync(full)) return [];
  const cut = excludes ? path.join(SRC, excludes) + path.sep : null;
  return walk(full).filter(
    (file) => (!cut || !file.startsWith(cut)) && !NOT_CLIENT_FILES.has(file),
  );
});

const SERVER_DIR = path.join(SRC, "server") + path.sep;

/**
 * Derived, not listed. A hand-written list only ever guards the module
 * someone remembered to add to it, and the leak this catches arrives as a NEW
 * client→server value import — exactly the case a list cannot see. Every
 * `src/server/` module the client trees value-import is a root here.
 */
const CLIENT_IMPORTED_SERVER_MODULES = [
  ...new Set(
    clientFiles.flatMap((file) =>
      valueImportsOf(file)
        .map((spec) => resolveAppImport(spec, file))
        .filter(
          (target): target is string => target?.startsWith(SERVER_DIR) === true,
        ),
    ),
  ),
].sort();

/** Module-scope state no client graph may reach: prisma, redis, EE audit. */
const SERVER_ONLY_STATE = new Set(
  [
    path.join(SRC, "server/db.ts"),
    path.join(SRC, "server/redis.ts"),
    path.join(SRC, "runtime/app/features/authz.ts"),
    path.join(APP_ROOT, "ee/audit-log/auditLog.ts"),
  ].map((p) => path.resolve(p)),
);

/** Walk `via` from a root to the target it was flooded from. */
const chainFromVia = (
  root: string,
  via: Map<string, string | null>,
): string[] => {
  const chain: string[] = [];
  const guard = new Set<string>();
  let cursor: string | undefined = root;
  while (cursor !== undefined && !guard.has(cursor)) {
    guard.add(cursor);
    chain.push(rel(cursor));
    const next = via.get(cursor);
    if (next == null) break;
    cursor = next;
  }
  return chain;
};

/**
 * Chains from each of `roots` to any of `targets`, as one walk and one
 * backwards flood — the same fixed point `chainsToBrowserUi` uses, and for
 * the same reason: a per-root BFS re-walks the whole graph once per root,
 * and there are hundreds of roots.
 */
const chainsToTargets = (
  roots: string[],
  targets: ReadonlySet<string>,
): Map<string, string[]> => {
  const { children } = walkImportGraph(roots);
  const parents = invertEdges(children);

  const via = new Map<string, string | null>();
  const work: string[] = [];
  for (const file of children.keys()) {
    if (!targets.has(path.resolve(file))) continue;
    via.set(file, null);
    work.push(file);
  }
  while (work.length > 0) {
    const node = work.pop()!;
    for (const parent of parents.get(node) ?? []) {
      if (via.has(parent)) continue;
      via.set(parent, node);
      work.push(parent);
    }
  }

  const chains = new Map<string, string[]>();
  for (const root of roots) {
    if (via.has(root)) chains.set(root, chainFromVia(root, via));
  }
  return chains;
};

/** Single-root form: the chain into any server-only state, or null. */
const chainToServerOnlyState = (root: string): string[] | null =>
  chainsToTargets([root], SERVER_ONLY_STATE).get(root) ?? null;

/**
 * Single-root, single-target form. The self-validation cases below name the
 * module they expect to travel through, and asking for "any server-only
 * state" would answer with whichever one the flood happened to settle first
 * — a real chain, but not the one under test, so the assertion would turn on
 * edge order rather than on the graph.
 */
const chainToServerModule = (root: string, target: string): string[] | null =>
  chainsToTargets([root], new Set([path.resolve(target)])).get(root) ?? null;

describe("client-imported vocabulary never reaches server-only state", () => {
  describe("given the import graph rooted at each client-imported server module", () => {
    it("finds no chain into prisma, redis, the audit writer, or the authz composition root", () => {
      const violations = [
        ...chainsToTargets(
          CLIENT_IMPORTED_SERVER_MODULES,
          SERVER_ONLY_STATE,
        ).values(),
      ].map((chain) => chain.join("\n     -> "));

      expect(violations).toEqual([]);
    });

    // The derivation replaced a hand-written list; if it ever stops finding
    // the rbac vocabulary, the guard above has quietly become a walk over
    // nothing.
    it("derives rbac.ts among the roots, so the guard is not walking an empty set", () => {
      expect(CLIENT_IMPORTED_SERVER_MODULES).toContain(
        path.join(SRC, "server/api/rbac.ts"),
      );
    });
  });

  // Self-validation, so the guard above cannot pass vacuously: a direct
  // prisma import and a transitive composition-root import must both report.
  describe("given a server file that imports prisma directly", () => {
    it("reports a chain, proving the walker sees the edge", () => {
      const chain = chainToServerModule(
        path.join(SRC, "server/api/trpc.ts"),
        path.join(SRC, "server/db.ts"),
      );

      expect(chain).not.toBeNull();
    });
  });

  describe("given a server file that reaches the composition root transitively", () => {
    it("reports the chain through the AuthZ feature runtime", () => {
      const runtime = path.join(SRC, "runtime/app/features/authz.ts");
      const chain = chainToServerModule(
        path.join(SRC, "server/app-layer/presets.ts"),
        runtime,
      );

      expect(chain).not.toBeNull();
      expect(chain).toContain(rel(runtime));
    });
  });

  // The negative half of the self-validation, and it has to name a module the
  // assertion above does NOT already cover — a client-imported root is
  // asserted clean up there, so re-asserting one here would only restate it.
  // The middleware consumes the request's contract service and holds no
  // database, Redis, or feature-server composition state of its own.
  describe("given a server module that consumes only the contract service", () => {
    it("reports no chain, so a clean root really is clean", () => {
      const shadow = path.join(
        SRC,
        "server/app-layer/authz/trpc-middleware.ts",
      );

      expect(CLIENT_IMPORTED_SERVER_MODULES).not.toContain(shadow);
      expect(chainToServerOnlyState(shadow)).toBeNull();
    });
  });
});
