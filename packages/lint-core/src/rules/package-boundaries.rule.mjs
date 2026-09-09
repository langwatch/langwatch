import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { classify } from "../classify.mjs";
import { defineRule } from "../define-rule.mjs";

// Per-import boundary policing: which workspace package may depend on which,
// and which runtime a package role may touch at all. `packageRole` used to be
// one message for seven different causes; it is five ids now, one per shape
// of violation, so the fix an agent reads names the actual mistake.

const workspaceCache = new Map();
const webDependencyCache = new Map();

function directories(path) {
  if (!existsSync(path)) return [];
  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

function loadWorkspace(cwd) {
  const cached = workspaceCache.get(cwd);
  if (cached) return cached;
  const packages = new Map();
  const addFeatures = (featuresRoot, enterprise) => {
    for (const feature of directories(featuresRoot)) {
      for (const role of ["contract", "server", "web"]) {
        const root = join(featuresRoot, feature, role);
        const manifestPath = join(root, "package.json");
        if (!existsSync(manifestPath)) continue;
        const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
        packages.set(manifest.name, {
          enterprise,
          exports: new Set(Object.keys(manifest.exports ?? {})),
          feature,
          role,
          root,
        });
      }
    }
  };
  addFeatures(join(cwd, "packages", "features"), false);
  addFeatures(join(cwd, "packages", "enterprise", "features"), true);
  const workspace = { packages };
  workspaceCache.set(cwd, workspace);
  return workspace;
}

function declaredWebDependencies(cwd) {
  const cached = webDependencyCache.get(cwd);
  if (cached) return cached;

  const dependencies = new Set();
  const path = join(cwd, "apps", "ui", "src", "features", "catalogue.json");
  if (!existsSync(path)) return dependencies;

  try {
    const catalogue = JSON.parse(readFileSync(path, "utf8"));
    const features = Array.isArray(catalogue.features) ? catalogue.features : [];
    for (const feature of features) {
      if (typeof feature?.root !== "string") continue;
      const surfaces = Array.isArray(feature.uses?.surfaces) ? feature.uses.surfaces : [];
      for (const surface of surfaces) {
        if (typeof surface === "string") dependencies.add(`${feature.root}:${surface}`);
      }
    }
  } catch {
    // The architecture validator reports malformed catalogues separately.
  }

  webDependencyCache.set(cwd, dependencies);
  return dependencies;
}

function packageRootForFile(filename, cwd) {
  const normalized = relative(cwd, filename).split(sep).join("/");
  const match = normalized.match(
    /^(packages\/(?:enterprise\/)?features\/[^/]+\/(?:contract|server|web))\//,
  );
  if (!match) return undefined;
  return resolve(cwd, match[1]);
}

function packageSubpath(specifier, packageName) {
  if (specifier === packageName) return ".";
  return `.${specifier.slice(packageName.length)}`;
}

function isFeatureServerCompositionRoot(workspacePath) {
  // `tests` alongside `src`, because a composition root's own test suite has to import exactly
  // what the root imports in order to test that it wires it. Without this the rule fires on the
  // one place the import is unavoidable, and the only ways out are to stop testing the wiring
  // or to record a rule gap as if it were debt. A test elsewhere is still held: this is scoped
  // to the composition workspaces, not to test files in general.
  return /^(apps\/(api|worker|tasks)|packages\/enterprise\/composition\/(api|worker))\/(?:src|tests)\//.test(
    workspacePath,
  );
}

function isRecognizedTestSource(workspacePath) {
  const namedTest = /\.(?:test|unit|integration|e2e)\.[cm]?[jt]sx?$/.test(workspacePath);
  const testDirectory = /(?:^|\/)(?:__tests__|tests)(?:\/|$)/.test(workspacePath);
  const runtimeDirectory = /(?:^|\/)(?:prisma|scripts?|seeds?)(?:\/|$)/.test(workspacePath);

  return namedTest && testDirectory && !runtimeDirectory;
}

function importedPackage(specifier, workspace) {
  for (const [name, pkg] of workspace.packages) {
    if (specifier === name || specifier.startsWith(`${name}/`)) {
      return { name, pkg };
    }
  }
  return undefined;
}

const RETIRED_PACKAGE_ENTRYPOINTS = new Map([
  ["zod/v3", "zod"],
  [
    "@langwatch/automations",
    "@langwatch/automation-contract, @langwatch/automation-server, or @langwatch/automation-web",
  ],
  ["@ee", "the owning @langwatch/enterprise-<feature>-<surface> package"],
]);

function retiredPackageReplacement(specifier) {
  for (const [retired, replacement] of RETIRED_PACKAGE_ENTRYPOINTS) {
    if (specifier === retired || specifier.startsWith(`${retired}/`)) {
      return replacement;
    }
  }
  return undefined;
}

export const boundaryRule = defineRule({
  name: "package-boundaries",
  kind: "problem",
  messages: {
    compositionRoot: {
      what: "Only a composition root (`apps/api`, `apps/worker`, `apps/tasks`, `packages/enterprise/composition/*`) may import a feature server package.",
      fix: "Import the feature's contract package here, or move this wiring into the composition root.",
    },
    crossFeature: {
      what: "`{{specifier}}` is another feature's server or web package.",
      fix: "Import the same capability from `@langwatch/{{feature}}-contract`; if it is not exported there, add it to the contract first.",
    },
    packageEscape: {
      what: "This relative import leaves `{{packageRoot}}`.",
      fix: "Import the target by its package name, or move the module into this package.",
    },
    contractRuntime: {
      what: "A contract package is transport-neutral: `{{specifier}}` is a node/browser/server runtime.",
      fix: "Move this code to the server or web package and keep only types and schemas here.",
    },
    webImportsServer: {
      what: "A web package cannot import a server package.",
      fix: "Call the API the server exposes, or import the type from the contract.",
    },
    serverImportsBrowser: {
      what: "A server package cannot import `{{specifier}}` (browser).",
      fix: "Move the browser-only value to the web package.",
    },
    coreImportsEnterprise: {
      what: "Core code cannot import enterprise packages.",
      fix: "Register the enterprise implementation through the composition root instead.",
    },
    deadAlias: {
      what: "`{{specifier}}` is a deleted alias (`~/`, `@app/`, `@ee/`).",
      fix: "Import the module by its package name.",
    },
    prismaContainment: {
      what: "Prisma may be imported only by a server repository adapter under src/repositories/prisma.",
      fix: "Move the query into a `*.repository.ts` there and call it through the service.",
    },
    featureLayer: {
      what: "`{{layer}}` cannot import `{{targetLayer}}`.",
      fix: "Depend on the port or service instead and let the composition root supply the concrete adapter.",
    },
    retiredPackageRuntime: {
      what: "This package entry point belongs to a retired runtime or package surface.",
      fix: "Use {{replacement}} instead.",
    },
    schemaBoundary: {
      what: "`{{specifier}}` binds the contract to Hono.",
      fix: "Export a plain Zod/Standard Schema and let the transport adapt it.",
    },
    sealedExports: {
      what: "`{{subpath}}` is not in `{{package}}`'s `exports`.",
      fix: "Import from a declared entry, or add the subpath to that package's `exports` if it is meant to be public.",
    },
  },
  create(context) {
    const filename = classify(context).filename;
    const classification = classify(context);
    const workspace = loadWorkspace(context.cwd);
    const productionSource = !/(\/__tests__\/|\/tests\/|\.(test|unit|integration)\.)/.test(
      classification.workspacePath,
    );

    const reportImport = (node, specifier) => {
      if (typeof specifier !== "string") return;
      const target = importedPackage(specifier, workspace);
      const replacement = retiredPackageReplacement(specifier);
      if (replacement) {
        context.report({
          node,
          messageId: "retiredPackageRuntime",
          data: { replacement },
        });
        return;
      }

      if (specifier.startsWith(".")) {
        const packageRoot = packageRootForFile(filename, context.cwd);
        if (packageRoot) {
          const targetPath = resolve(dirname(filename), specifier);
          const escaped = relative(packageRoot, targetPath).startsWith("..");
          if (escaped) {
            context.report({
              node,
              messageId: "packageEscape",
              data: { packageRoot: relative(context.cwd, packageRoot).split(sep).join("/") },
            });
          }

          // Production sources only: a service's own unit test composes it with
          // the real adapter or repository it runs against, which is the point of
          // the test rather than a layering breach.
          if (
            !escaped &&
            productionSource &&
            classification.layoutVersion === 0 &&
            classification.role === "server"
          ) {
            const targetWorkspacePath = relative(context.cwd, targetPath).split(sep).join("/");
            const importer = classification.workspacePath;
            const apiImportsImplementation =
              /\/server\/src\/api\//.test(importer) &&
              /\/server\/src\/(?:adapters|migrations|projections|repositories|stores)\//.test(
                `/${targetWorkspacePath}`,
              );
            const serviceImportsOuterLayer =
              /\/server\/src\/services\//.test(importer) &&
              /\/server\/src\/(?:api|migrations)\//.test(`/${targetWorkspacePath}`);
            const serviceImportsConcreteAdapter =
              /\/server\/src\/services\//.test(importer) &&
              /\/server\/src\/(?:adapters\/|repositories\/[^/]+\/|stores\/[^/]+\/)/.test(
                `/${targetWorkspacePath}`,
              );
            if (apiImportsImplementation) {
              context.report({
                node,
                messageId: "featureLayer",
                data: { layer: "api", targetLayer: "the persistence or infrastructure layer" },
              });
            } else if (serviceImportsOuterLayer) {
              context.report({
                node,
                messageId: "featureLayer",
                data: { layer: "service", targetLayer: "the api or migrations layer" },
              });
            } else if (serviceImportsConcreteAdapter) {
              context.report({
                node,
                messageId: "featureLayer",
                data: { layer: "service", targetLayer: "a concrete adapter" },
              });
            }
          }
        }
      }

      if (target) {
        const subpath = packageSubpath(specifier, target.name);
        const declaredWebDependency =
          classification.role === "web" &&
          target.pkg.role === "web" &&
          declaredWebDependencies(context.cwd).has(`${classification.feature}:${specifier}`);
        // `./testing` is a package's declared test seam. A server package
        // publishes one for the runtimes that compose it; a web package
        // publishes one for the browser features that render it. Either way
        // only a recognized test source may walk through it.
        const testSeamRole =
          (target.pkg.role === "server" &&
            (classification.role === "other" || classification.role === "server")) ||
          (target.pkg.role === "web" &&
            (classification.role === "other" || classification.role === "web"));
        const testSupportImport =
          testSeamRole &&
          subpath === "./testing" &&
          target.pkg.exports.has(subpath) &&
          isRecognizedTestSource(classification.workspacePath);
        // A web feature's public surface is exactly `surfaces/<id>` for other web
        // features and `screens/<owner>` for the browser application. A screen is
        // therefore not collaboration between features, and the bare package entry
        // and every other subpath stay private.
        const webSurfaceImport =
          target.pkg.role === "web" &&
          classification.role === "web" &&
          /^\.\/surfaces\/[^/]+$/.test(subpath);
        if (!target.pkg.exports.has(subpath)) {
          context.report({
            node,
            messageId: "sealedExports",
            data: { subpath, package: target.name },
          });
        }
        if (
          classification.feature &&
          target.pkg.feature !== classification.feature &&
          target.pkg.role !== "contract" &&
          !testSupportImport &&
          !webSurfaceImport &&
          !declaredWebDependency
        ) {
          context.report({
            node,
            messageId: "crossFeature",
            data: { specifier, feature: target.pkg.feature },
          });
        }
        if (
          !classification.enterprise &&
          classification.role !== "other" &&
          target.pkg.enterprise
        ) {
          context.report({ node, messageId: "coreImportsEnterprise" });
        }
        if (classification.role === "contract" && target.pkg.role !== "contract") {
          context.report({ node, messageId: "contractRuntime", data: { specifier } });
        }
        if (classification.role === "web" && target.pkg.role === "server") {
          context.report({ node, messageId: "webImportsServer" });
        }
        if (classification.role === "server" && target.pkg.role === "web") {
          context.report({ node, messageId: "serverImportsBrowser", data: { specifier } });
        }
        if (
          classification.role === "other" &&
          target.pkg.role === "server" &&
          !isFeatureServerCompositionRoot(classification.workspacePath) &&
          !testSupportImport
        ) {
          context.report({ node, messageId: "compositionRoot" });
        }
      }

      const prismaImport =
        specifier === "@prisma/client" ||
        /generated\/prisma|generated-prisma|prisma\/client/.test(specifier);
      if (prismaImport && classification.feature) {
        const allowed =
          classification.role === "server" &&
          /\/src\/repositories\/prisma\//.test(`/${classification.workspacePath}`);
        if (!allowed) context.report({ node, messageId: "prismaContainment" });
      }

      if (
        classification.feature &&
        (specifier === "@hono/zod-validator" || specifier === "hono-openapi/zod")
      ) {
        context.report({ node, messageId: "schemaBoundary", data: { specifier } });
      }

      const nodeRuntime = specifier.startsWith("node:");
      const browserRuntime = /^(react|react-dom|@chakra-ui\/)/.test(specifier);
      const serverRuntime = /^(hono|@trpc\/server|@langwatch\/(eventing|group-queue))/.test(
        specifier,
      );
      if (
        productionSource &&
        classification.role === "contract" &&
        (nodeRuntime || browserRuntime || serverRuntime)
      ) {
        context.report({ node, messageId: "contractRuntime", data: { specifier } });
      }
      if (productionSource && classification.role === "web" && (nodeRuntime || serverRuntime)) {
        context.report({ node, messageId: "webImportsServer" });
      }
      if (productionSource && classification.role === "server" && browserRuntime) {
        context.report({ node, messageId: "serverImportsBrowser", data: { specifier } });
      }
      if (
        productionSource &&
        classification.role !== "other" &&
        // `~/`, `@app/` and `@ee/` were the deleted platform application's own
        // aliases. Nothing resolves them any more, so an import naming one is a
        // reintroduction, not a legacy edge — and is reported as such.
        /^(~\/|@app\/|@ee\/)/.test(specifier)
      ) {
        context.report({ node, messageId: "deadAlias", data: { specifier } });
      }
    };

    return {
      ImportDeclaration(node) {
        reportImport(node.source, node.source.value);
      },
      ExportNamedDeclaration(node) {
        if (node.source) reportImport(node.source, node.source.value);
      },
      ExportAllDeclaration(node) {
        reportImport(node.source, node.source.value);
      },
      ImportExpression(node) {
        if (node.source.type === "Literal") {
          reportImport(node.source, node.source.value);
        }
      },
      CallExpression(node) {
        if (
          node.callee.type === "Identifier" &&
          node.callee.name === "require" &&
          node.arguments[0]?.type === "Literal"
        ) {
          reportImport(node.arguments[0], node.arguments[0].value);
        }
      },
    };
  },
});
