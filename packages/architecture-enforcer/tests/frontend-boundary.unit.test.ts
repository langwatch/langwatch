/**
 * @vitest-environment node
 * @see specs/setup/memory-footprint.feature
 * Transitive: one type-name import once pulled 2,020 browser-only modules into the API/worker.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { browserOnlyPackage } from "../src/policies/frontend/browser-packages.ts";
import { walkFiles } from "../src/workspace/layout.ts";
import {
  chainsToSeeds,
  createWorkspaceModuleResolver,
  moduleImports,
  rendersJsx,
  valueImports,
  walkValueImportGraph,
  type ValueImportGraph,
} from "../src/workspace/module-graph.ts";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/**
 * The one allowed terminal: `@langwatch/mail` renders templates with react-email,
 * server-side. It's a TERMINAL (the walk stops on entry), not an excused importer, so
 * a file reaching React some other way is still reported.
 */
const MAIL_PACKAGE = join(REPO_ROOT, "packages", "mail") + sep;

const isMailTerminal = ({ file }: { file: string }): boolean => file.startsWith(MAIL_PACKAGE);

const isProductionSource = (file: string): boolean =>
  /\.(?:mts|cts|tsx?)$/.test(file) &&
  !/\.d\.(?:mts|cts|ts)$/.test(file) &&
  !/\.(?:test|spec)\.[cm]?tsx?$/.test(file) &&
  !file.includes(`${sep}__tests__${sep}`) &&
  !file.includes(`${sep}__mocks__${sep}`);

const subdirectories = (path: string): string[] =>
  existsSync(path)
    ? readdirSync(path, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .toSorted()
    : [];

const show = (path: string): string =>
  path.startsWith(REPO_ROOT) ? relative(REPO_ROOT, path) : path;

const API_SRC = join(REPO_ROOT, "apps", "api", "src");
const WORKER_SRC = join(REPO_ROOT, "apps", "worker", "src");

/**
 * The process entrypoints, and every composition module: a composition is wired into a
 * process by name, so a browser package on one is a browser package in the process that
 * composes it, whether or not today's entrypoint happens to reach it.
 */
const applicationRoots = (): string[] => {
  const roots: string[] = [];
  for (const entrypoint of [join(API_SRC, "main.ts"), join(WORKER_SRC, "main.ts")]) {
    if (existsSync(entrypoint)) roots.push(entrypoint);
  }
  for (const source of [API_SRC, WORKER_SRC]) {
    for (const file of walkFiles(source, isProductionSource)) {
      if (file.endsWith(".composition.ts")) roots.push(file);
    }
  }
  return roots;
};

/**
 * Every server-side source tree a feature or platform package owns — derived, not listed.
 * A hand-written list only ever guards the package somebody remembered to add to it, and a
 * new feature package is exactly the case a list cannot see.
 */
const serverPackageRoots = (): string[] => {
  const roots: string[] = [];
  for (const feature of subdirectories(join(REPO_ROOT, "modules"))) {
    const source = join(REPO_ROOT, "modules", feature, "process", "src");
    if (existsSync(source)) roots.push(source);
  }
  for (const packageName of subdirectories(join(REPO_ROOT, "packages"))) {
    const source = join(REPO_ROOT, "packages", packageName, "src", "server");
    if (existsSync(source)) roots.push(source);
  }
  return roots.toSorted();
};

const SERVER_PACKAGE_ROOTS = serverPackageRoots();

const BACKEND_ROOTS = [
  ...new Set([
    ...applicationRoots(),
    ...SERVER_PACKAGE_ROOTS.flatMap((root) => walkFiles(root, isProductionSource)),
  ]),
].toSorted();

/**
 * The browser package trees: a backend graph may not reach a module inside one at all —
 * not just the toolkits it imports today. A module that looks framework-free can acquire
 * a React edge later, and browser-code review would not know a backend process is downstream.
 */
const browserModuleRoots = (): string[] => {
  const roots = [join(REPO_ROOT, "apps", "ui")];
  for (const feature of subdirectories(join(REPO_ROOT, "modules"))) {
    const web = join(REPO_ROOT, "modules", feature, "web");
    if (existsSync(web)) roots.push(web);
  }
  return roots.map((root) => root + sep);
};

const BROWSER_MODULE_ROOTS = browserModuleRoots();

const bannedModule = (target: string | undefined): string | undefined =>
  target !== void 0 && BROWSER_MODULE_ROOTS.some((root) => target.startsWith(root))
    ? show(target)
    : void 0;

const resolver = createWorkspaceModuleResolver({ root: REPO_ROOT });

/**
 * Two walks rather than one, so each answer is exact. A single walk settles every tainted
 * file on ONE cause, so a root reaching both a browser package and a browser module would
 * report under whichever the flood reached first — real, but not what either assertion asks.
 */
const graphReaching = ({
  roots,
  packages,
  modules,
}: {
  roots: readonly string[];
  packages: boolean;
  modules: boolean;
}): ValueImportGraph =>
  walkValueImportGraph({
    roots,
    resolve: resolver.resolve,
    forbidden: ({ specifier, target }) => {
      if (packages) {
        const name = browserOnlyPackage(specifier);
        if (name) return `package ${name}`;
      }
      if (modules) {
        const module = bannedModule(target);
        if (module) return `browser module ${module}`;
      }
      return void 0;
    },
    terminal: isMailTerminal,
    emitted: packages
      ? ({ file }) => (rendersJsx({ file }) ? "react/jsx-runtime" : void 0)
      : void 0,
  });

const chains = ({
  roots,
  packages,
  modules,
}: {
  roots: readonly string[];
  packages: boolean;
  modules: boolean;
}): string[] =>
  [
    ...chainsToSeeds({
      roots,
      graph: graphReaching({ roots, packages, modules }),
    }).values(),
  ]
    .map((chain) => chain.map(show).join("\n     -> "))
    .toSorted();

/** Single-file form, for the self-validation cases. */
const chainFromFile = ({
  file,
  packages = true,
  modules = false,
}: {
  file: string;
  packages?: boolean;
  modules?: boolean;
}): string | undefined => chains({ roots: [file], packages, modules })[0];

const PACKAGE_GRAPH = graphReaching({ roots: BACKEND_ROOTS, packages: true, modules: false });

describe("browser-only UI never reaches backend code", () => {
  describe("given the value-import graph rooted at every backend entrypoint, composition and server package source", () => {
    // Without this, a roots list that silently emptied — a renamed entrypoint,
    // a moved package tree — would make every assertion below pass over
    // nothing, which reads exactly like finding nothing.
    it("roots the walk at the process entrypoints, the compositions and every server package", () => {
      expect(BACKEND_ROOTS).toContain(join(API_SRC, "main.ts"));
      expect(BACKEND_ROOTS).toContain(join(WORKER_SRC, "main.ts"));
      expect(
        BACKEND_ROOTS.filter((file) => file.endsWith(".composition.ts")).length,
      ).toBeGreaterThan(50);
      expect(SERVER_PACKAGE_ROOTS.length).toBeGreaterThan(30);
      expect(SERVER_PACKAGE_ROOTS).toContain(
        join(REPO_ROOT, "packages", "eventing", "src", "server"),
      );
      expect(PACKAGE_GRAPH.children.size).toBeGreaterThan(BACKEND_ROOTS.length);
    });

    /** @scenario "Server code cannot reach browser-only UI, even transitively" */
    it("finds no chain from backend code into a browser-only package", () => {
      expect(chains({ roots: BACKEND_ROOTS, packages: true, modules: false })).toEqual([]);
    });

    /** @scenario "Backend code never imports a module out of a browser package" */
    it("finds no chain from backend code into an apps/ui or feature web module", () => {
      expect(chains({ roots: BACKEND_ROOTS, packages: false, modules: true })).toEqual([]);
    });
  });

  // Without these, a walker that silently stopped resolving would make the
  // assertions above pass vacuously.
  describe("given a component that genuinely renders Chakra", () => {
    it("still reports a chain, proving the walker resolves imports", () => {
      const component = join(
        REPO_ROOT,
        "modules/agent/browser/src/features/management/ui/blocks/agent-card.tsx",
      );
      expect(existsSync(component)).toBe(true);

      expect(chainFromFile({ file: component })).toBeDefined();
    });
  });

  // The compiler-emitted `react/jsx-runtime` import is the one edge that is in
  // no file's source. An icon component is the sharpest case: it has no import
  // statement whatsoever, so without this rule it is a dead end in the walk
  // rather than the React leaf it actually is.
  describe("given a component whose only React edge is the JSX runtime", () => {
    const icon = join(REPO_ROOT, "modules/auth/browser/src/ui/elements/logo-icon.tsx");

    it("reports a chain, even with no import statement in the file", () => {
      expect(existsSync(icon)).toBe(true);
      expect(moduleImports({ file: icon })).toEqual([]);

      expect(chainFromFile({ file: icon })).toBeDefined();
    });

    it("leaves a .tsx that renders nothing alone, so the rule is not the extension", () => {
      const noJsx = join(REPO_ROOT, "modules/trace/browser/src/ui/elements/close-button.tsx");
      expect(existsSync(noJsx)).toBe(true);

      expect(rendersJsx({ file: noJsx })).toBe(false);
      expect(rendersJsx({ file: icon })).toBe(true);
    });
  });

  // Both halves are pinned — asserting only the exclusion passes even if the
  // import is deleted. `moduleImports` sees the statement; `valueImports`
  // refuses to count it — that is what lets a backend file name a browser
  // component's props without being reported.
  describe("given a type-only import of a browser package", () => {
    const module = join(REPO_ROOT, "modules/annotation/browser/src/model/annotation-form-types.ts");
    const specifier = "react";

    it("still makes that import, so the case has a subject", () => {
      expect(
        moduleImports({ file: module }).filter((entry) => entry.specifier === specifier),
      ).toHaveLength(1);
    });

    it("does not count it, because types are erased", () => {
      expect(valueImports({ file: module }).map((entry) => entry.specifier)).not.toContain(
        specifier,
      );
      expect(chainFromFile({ file: module })).toBeUndefined();
    });
  });

  // Workspace packages were invisible to the platform walk until `@langwatch/react-rum` was
  // found reaching three backend files. These two pin both halves: the barrel must still look
  // dangerous, and the leaf must still look safe — losing either reopens the blind spot or
  // turns every safe import into a false positive.
  describe("given a workspace package whose barrel re-exports browser tracing", () => {
    it("reports a chain through the barrel", () => {
      const barrel = resolver.resolve({
        specifier: "@langwatch/react-rum",
        file: join(API_SRC, "main.ts"),
      });

      expect(barrel).toBeDefined();
      expect(chainFromFile({ file: barrel! })).toBeDefined();
    });

    it("reports none through its framework-free constants subpath", () => {
      const constants = resolver.resolve({
        specifier: "@langwatch/react-rum/constants",
        file: join(API_SRC, "main.ts"),
      });

      expect(constants).toBeDefined();
      expect(chainFromFile({ file: constants! })).toBeUndefined();
    });
  });

  // Deferring a heavy dependency behind `await import()` is the technique that
  // keeps it out of a boot graph, so it is also the easiest way to smuggle the
  // UI stack back in. These two pin the value/type split: miss the first and
  // the walk has a hole, break the second and every `import("pkg").Type`
  // annotation becomes a false leak.
  describe("given a dynamic import", () => {
    it("follows one in value position, so a deferred require cannot hide", () => {
      const specifiers = valueImports({
        file: join(
          REPO_ROOT,
          "apps/worker/src/platform/infrastructure/worker-pii-analysis.adapter.ts",
        ),
      }).map((entry) => entry.specifier);

      expect(specifiers).toContain("@google-cloud/dlp");
    });

    it("ignores one in type position, because the annotation is erased", () => {
      const adapter = join(
        REPO_ROOT,
        "modules/analytics/process/src/adapters/analytics.adapter.ts",
      );

      // Both halves, so the case cannot pass by losing its subject: the file
      // still writes the type query, and the walk still refuses to count it.
      expect(readFileSync(adapter, "utf8")).toContain('import("@clickhouse/client")');
      expect(valueImports({ file: adapter }).map((entry) => entry.specifier)).not.toContain(
        "@clickhouse/client",
      );
    });
  });

  // 110 edges in the feature packages are `#`-prefixed subpath imports, which a
  // resolver ignorant of a manifest's `imports` map drops in silence. A dropped
  // edge is a hole in the guard that looks exactly like a clean graph.
  describe("given a package-internal subpath import", () => {
    it("resolves it through the owning manifest's imports map", () => {
      const transport = join(
        REPO_ROOT,
        "modules/dashboard/process/src/transport/api-rest/dashboard.api.ts",
      );
      expect(valueImports({ file: transport }).map((entry) => entry.specifier)).toContain(
        "#app/dashboard.app",
      );

      expect(resolver.resolve({ specifier: "#app/dashboard.app", file: transport })).toBe(
        join(REPO_ROOT, "modules/dashboard/process/src/app/dashboard.app.ts"),
      );
    });
  });

  // The single exception has to keep naming a real React user, and has to keep
  // being only that package. A terminal that widened would take the guard's
  // teeth with it, silently.
  describe("given the one allowed exception", () => {
    const template = join(REPO_ROOT, "packages/mail/src/templates/invite-email.tsx");

    it("names a package that genuinely renders React server-side", () => {
      expect(existsSync(template)).toBe(true);
      // react-email templates are JSX, so their React edge is the one the
      // compiler emits rather than one they write. Excused or not, the walk has
      // to be able to SEE it, or the exception excuses nothing.
      expect(rendersJsx({ file: template })).toBe(true);
      expect(chainFromFile({ file: template })).toBeDefined();

      expect(isMailTerminal({ file: template })).toBe(true);
    });

    it("stops at that package and nowhere else", () => {
      // The sharpest subject used to be the worker's own react-email template, a twin of one
      // this package already held; it moved here, which is what made the exception mean
      // something. This case asks the same question of a file outside the package instead —
      // a terminal widened to "anything that renders mail" would take the guard's teeth with it.
      const outside = join(
        REPO_ROOT,
        "modules/agent/browser/src/features/management/ui/blocks/agent-card.tsx",
      );
      expect(existsSync(outside)).toBe(true);

      expect(isMailTerminal({ file: outside })).toBe(false);
      expect(chainFromFile({ file: outside })).toBeDefined();
    });

    // An exception nothing exercises excuses nothing, and reads exactly like an
    // exception that works. When this guard was rebuilt no backend root
    // imported `@langwatch/mail` at all — mail left through ports and the two
    // processes that rendered it wrote their own templates — so the terminal
    // was inert and the twins it should have prevented already existed.
    it("is reached by a real backend root, so the terminal is exercised", () => {
      const composition = join(REPO_ROOT, "apps/worker/src/app/worker-mail.composition.ts");
      expect(BACKEND_ROOTS).toContain(composition);
      expect(valueImports({ file: composition }).map((entry) => entry.specifier)).toContain(
        "@langwatch/mail",
      );

      // The package COMPILES now — Node cannot load `.tsx`, and its templates are the only
      // JSX a server process boots through — so a backend root reaches `dist/`, which this
      // walk never reads (not source, and maybe not even built here). The terminal must cover
      // both halves — the compiled entry processes import, and the `src` a test/studio still
      // imports directly — or it would report the one it misses.
      const manifest: { exports: { ".": { import: string } } } = JSON.parse(
        readFileSync(join(REPO_ROOT, "packages/mail/package.json"), "utf8"),
      );
      const entry = join(REPO_ROOT, "packages/mail", manifest.exports["."].import);
      expect(entry.startsWith(join(REPO_ROOT, "packages", "mail", "dist") + sep)).toBe(true);
      expect(isMailTerminal({ file: entry })).toBe(true);
      expect(isMailTerminal({ file: template })).toBe(true);

      // And the walk stops there: the composition reaches the package, the
      // package renders React, and no chain is reported for either.
      expect(chainFromFile({ file: composition })).toBeUndefined();
      expect(chainFromFile({ file: join(WORKER_SRC, "main.ts") })).toBeUndefined();
    });
  });
});
