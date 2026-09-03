/**
 * @vitest-environment node
 *
 * @see specs/setup/memory-footprint.feature — "Server code cannot reach
 * browser-only UI, even transitively" and "Backend code never imports a module
 * out of a browser package"
 *
 * An architectural guard, not a snapshot. It walks the real value-import graph
 * the way Node does and fails with the offending chain.
 *
 * It has to be transitive, because the leak it prevents was invisible to a
 * direct-import check: one route module imported a single display-name constant
 * from a React component, and that hop pulled Chakra UI, Ark UI, Emotion,
 * react-dom and react-router — 2,020 modules of browser-only code — into the
 * API, worker and ingestion processes alike.
 *
 * Only VALUE imports are followed: `import type` is erased at compile time and
 * cannot pull a module at runtime, so backend code may freely name a
 * component's types.
 *
 * This is the rebuild of `platform/app/src/server/__tests__/frontend-boundary.unit.test.ts`,
 * which went with the platform application in Cutover C. Nineteen of its twenty
 * subjects no longer existed, so the roots are new; the contract is not.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { walkFiles } from "../src/files";
import {
  chainsToSeeds,
  createWorkspaceModuleResolver,
  moduleImports,
  rendersJsx,
  valueImports,
  walkValueImportGraph,
  type ValueImportGraph,
} from "../src/module-graph";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/**
 * Packages that only make sense in a browser. Prefix-matched on the specifier.
 *
 * The OpenTelemetry entries are deliberately narrow. Most of `@opentelemetry/*`
 * is isomorphic and the backend legitimately depends on it (`api`, `core`,
 * `resources`, `sdk-trace-base`, `semantic-conventions`, the OTLP exporters);
 * only these three are browser-bound — a `WebTracerProvider`, and
 * instrumentation for the DOM and `window.fetch`. Banning the scope wholesale
 * would make this guard unusable; leaving the scope out entirely is what let
 * the `@langwatch/react-rum` barrel reach three backend files unnoticed.
 *
 * `motion` is here alongside `framer-motion` because it is the same library
 * under its current name, and it is already a dependency of the web packages.
 * Listing only the old name is the same shape of gap.
 */
const BROWSER_ONLY_PACKAGES = [
  "react",
  "react-dom",
  "react-router",
  "react-feather",
  "lucide-react",
  "framer-motion",
  "motion",
  "@chakra-ui",
  "@ark-ui",
  "@emotion",
  "@zag-js",
  "@opentelemetry/sdk-trace-web",
  "@opentelemetry/instrumentation-document-load",
  "@opentelemetry/instrumentation-fetch",
];

/**
 * The one allowed terminal: `@langwatch/mail` renders its templates with
 * react-email, server-side, at send time. React is legitimate there and nowhere
 * else on a backend graph.
 *
 * It is a TERMINAL rather than an excused importer — the walk stops on entry —
 * so a service that sends mail is not reported for the React its templates
 * legitimately use, while a file that reaches React some other way still is.
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
        .sort()
    : [];

const show = (path: string): string =>
  path.startsWith(REPO_ROOT) ? relative(REPO_ROOT, path) : path;

const API_SRC = join(REPO_ROOT, "apps", "api", "src");
const WORKER_SRC = join(REPO_ROOT, "apps", "worker", "src");

/**
 * The process entrypoints, and every composition module.
 *
 * The entrypoints matter more than anything under them: whatever they reach is,
 * by definition, resident in a running backend process. The compositions matter
 * because they are what an entrypoint reaches — a composition is wired into a
 * process by name, so a browser package on one is a browser package in the
 * process that composes it, whether or not today's entrypoint happens to.
 */
const applicationRoots = (): string[] => {
  const roots: string[] = [];
  for (const entrypoint of [
    join(API_SRC, "api.main.ts"),
    join(WORKER_SRC, "worker.entrypoint.ts"),
  ]) {
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
 * Every server-side source tree a feature or platform package owns.
 *
 * Derived, not listed. A hand-written list only ever guards the package
 * somebody remembered to add to it, and a new feature package is exactly the
 * case a list cannot see.
 */
const serverPackageRoots = (): string[] => {
  const roots: string[] = [];
  for (const feature of subdirectories(join(REPO_ROOT, "packages", "features"))) {
    const source = join(REPO_ROOT, "packages", "features", feature, "server", "src");
    if (existsSync(source)) roots.push(source);
  }
  for (const packageName of subdirectories(join(REPO_ROOT, "packages"))) {
    const source = join(REPO_ROOT, "packages", packageName, "src", "server");
    if (existsSync(source)) roots.push(source);
  }
  return roots.sort();
};

const SERVER_PACKAGE_ROOTS = serverPackageRoots();

const BACKEND_ROOTS = [
  ...new Set([
    ...applicationRoots(),
    ...SERVER_PACKAGE_ROOTS.flatMap((root) => walkFiles(root, isProductionSource)),
  ]),
].sort();

/**
 * The browser package trees. A backend graph may not reach a module inside one
 * at all — not only the browser toolkits it happens to import today.
 *
 * The distinction is the point. `apps/ui` and each feature's `web` package are
 * built for a browser and reviewed as browser code; a module in one that looks
 * framework-free today acquires a React edge the next time somebody edits it,
 * and nothing in that review would say a backend process is downstream.
 */
const browserModuleRoots = (): string[] => {
  const roots = [join(REPO_ROOT, "apps", "ui")];
  for (const feature of subdirectories(join(REPO_ROOT, "packages", "features"))) {
    const web = join(REPO_ROOT, "packages", "features", feature, "web");
    if (existsSync(web)) roots.push(web);
  }
  return roots.map((root) => root + sep);
};

const BROWSER_MODULE_ROOTS = browserModuleRoots();

const bannedPackage = (specifier: string): string | undefined =>
  BROWSER_ONLY_PACKAGES.find(
    (name) => specifier === name || specifier.startsWith(`${name}/`),
  );

const bannedModule = (target: string | undefined): string | undefined =>
  target !== void 0 && BROWSER_MODULE_ROOTS.some((root) => target.startsWith(root))
    ? show(target)
    : void 0;

const resolver = createWorkspaceModuleResolver({ root: REPO_ROOT });

/**
 * Two walks rather than one, so each answer is exact. A single walk settles
 * every tainted file on ONE cause, so a root reaching both a browser package
 * and a browser module would be reported under whichever the flood reached
 * first — a real chain, but not an answer to the question either assertion
 * asks.
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
        const name = bannedPackage(specifier);
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
    .sort();

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
      expect(BACKEND_ROOTS).toContain(join(API_SRC, "api.main.ts"));
      expect(BACKEND_ROOTS).toContain(join(WORKER_SRC, "worker.entrypoint.ts"));
      expect(BACKEND_ROOTS.filter((file) => file.endsWith(".composition.ts")).length).
        toBeGreaterThan(50);
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
        "packages/features/agent/web/src/features/management/ui/blocks/agent-card.tsx",
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
    const icon = join(REPO_ROOT, "packages/features/auth/web/src/ui/elements/logo-icon.tsx");

    it("reports a chain, even with no import statement in the file", () => {
      expect(existsSync(icon)).toBe(true);
      expect(moduleImports({ file: icon })).toEqual([]);

      expect(chainFromFile({ file: icon })).toBeDefined();
    });

    it("leaves a .tsx that renders nothing alone, so the rule is not the extension", () => {
      const noJsx = join(
        REPO_ROOT,
        "packages/features/trace/web/src/ui/elements/close-button.tsx",
      );
      expect(existsSync(noJsx)).toBe(true);

      expect(rendersJsx({ file: noJsx })).toBe(false);
      expect(rendersJsx({ file: icon })).toBe(true);
    });
  });

  // Both halves are pinned. Asserting only the exclusion passes just as
  // happily when the import is deleted — which is how the platform version of
  // this case quietly lost its subject.
  describe("given a type-only import of a browser package's module", () => {
    const server = join(
      REPO_ROOT,
      "packages/features/dashboard/server/src/transport/api-trpc/saved-workbench-chart.transport-errors.ts",
    );
    const specifier = "@langwatch/analytics-web/validation";

    it("still makes that import, so the case has a subject", () => {
      expect(
        moduleImports({ file: server }).filter((entry) => entry.specifier === specifier),
      ).toHaveLength(1);
    });

    it("does not count it, because types are erased", () => {
      expect(valueImports({ file: server }).map((entry) => entry.specifier)).not.toContain(
        specifier,
      );
    });
  });

  // Workspace packages were invisible to the platform walk until
  // `@langwatch/react-rum` was found reaching three backend files. These two
  // pin both halves of the resolution: the barrel must still look dangerous,
  // and the leaf must still look safe. If the first stopped failing the guard
  // would be blind again; if the second started failing, every safe import
  // would be a false positive and the guard would be ignored.
  describe("given a workspace package whose barrel re-exports browser tracing", () => {
    it("reports a chain through the barrel", () => {
      const barrel = resolver.resolve({
        specifier: "@langwatch/react-rum",
        file: join(API_SRC, "api.main.ts"),
      });

      expect(barrel).toBeDefined();
      expect(chainFromFile({ file: barrel! })).toBeDefined();
    });

    it("reports none through its framework-free constants subpath", () => {
      const constants = resolver.resolve({
        specifier: "@langwatch/react-rum/constants",
        file: join(API_SRC, "api.main.ts"),
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
        "packages/features/analytics/server/src/adapters/analytics.adapter.ts",
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
        "packages/features/dashboard/server/src/transport/api-rest/dashboard.api.ts",
      );
      expect(valueImports({ file: transport }).map((entry) => entry.specifier)).toContain(
        "#app/dashboard.app",
      );

      expect(resolver.resolve({ specifier: "#app/dashboard.app", file: transport })).toBe(
        join(REPO_ROOT, "packages/features/dashboard/server/src/app/dashboard.app.ts"),
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
      const workerTemplate = join(
        REPO_ROOT,
        "apps/worker/src/features/automation/trigger-digest-mail.template.ts",
      );
      expect(existsSync(workerTemplate)).toBe(true);

      expect(isMailTerminal({ file: workerTemplate })).toBe(false);
    });
  });
});
