import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

import { classify } from "../classify.mjs";
import { defineRule } from "../define-rule.mjs";

// Per-import boundary policing: which workspace package may depend on which,
// and which runtime a package role may touch at all. `packageRole` used to be
// one message for seven different causes; it is five ids now, one per shape
// of violation, so the fix an agent reads names the actual mistake.

const workspaceCache = new Map();

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
  addFeatures(join(cwd, "modules"), false);
  addFeatures(join(cwd, "enterprise", "modules"), true);
  const workspace = { packages };
  workspaceCache.set(cwd, workspace);
  return workspace;
}

const packageRootCache = new Map();

// The nearest package.json above the file, so every workspace member is held,
// not just the module roles this used to name. It named contract|server|web,
// which the process/browser rename left matching nothing, and packages/* was
// never in scope at all -- 36 configs reached into another package's src/.
function packageRootForFile(filename, cwd) {
  let directory = dirname(resolve(cwd, filename));
  const visited = [];
  for (;;) {
    const cached = packageRootCache.get(directory);
    if (cached !== undefined) {
      for (const seen of visited) packageRootCache.set(seen, cached);
      return cached ?? undefined;
    }
    visited.push(directory);
    if (existsSync(join(directory, "package.json"))) {
      for (const seen of visited) packageRootCache.set(seen, directory);
      return directory;
    }
    const parent = dirname(directory);
    const reachedRoot = parent === directory || relative(cwd, parent).startsWith("..");
    if (reachedRoot) {
      for (const seen of visited) packageRootCache.set(seen, null);
      return undefined;
    }
    directory = parent;
  }
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
  return /^apps\/(api|worker|tasks)\/(?:src|tests)\//.test(workspacePath);
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
    "@langwatch/automation-contract, @langwatch/automation-process, or @langwatch/automation-browser",
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
      what: "`{{specifier}}` is a feature server package, and only a composition root (`apps/api`, `apps/worker`, `apps/tasks`, `enterprise/packages/composition/*`) may import one.",
      fix: "Import the capability from that feature's contract package here, and do the wiring that needs `{{specifier}}` in the composition root that already builds the app.",
    },
    crossFeature: {
      what: "`{{specifier}}` is another feature's server or web package.",
      fix: "Import the same capability from `@langwatch/{{feature}}-contract`; if it is not exported there, add it to the contract first.",
    },
    packageEscape: {
      what: "`{{specifier}}` resolves outside `{{packageRoot}}`, so this package depends on a file it does not own.",
      fix: "Replace `{{specifier}}` with the target's package name — `@langwatch/<feature>-<contract|process|browser|browser-kit>` for a module package, `@langwatch/<name>` for any other workspace package. Move the file into `{{packageRoot}}` instead only when nothing outside `{{packageRoot}}` imports it.",
    },
    contractRuntime: {
      what: "A contract package is transport-neutral: `{{specifier}}` is a node, browser or server runtime.",
      fix: "Keep only types and schemas here, and move the code that calls `{{specifier}}` to the feature's server package when it is a `node:` or server import, or to its web package when it is a browser import.",
    },
    webImportsServer: {
      what: "`{{specifier}}` is server-only, and this is a web package.",
      fix: "Call the REST or tRPC endpoint the server exposes through this feature's web client, and import any shared type from `@langwatch/<feature>-contract`.",
    },
    serverImportsBrowser: {
      what: "A server package cannot import `{{specifier}}` (browser).",
      fix: "Move the browser-only value to the web package.",
    },
    coreImportsEnterprise: {
      what: "`{{specifier}}` is an enterprise package, and this is core code.",
      fix: "Declare the capability as a peer API in this feature's contract package (its `*Api` token) and depend on that interface here; the enterprise module installs like any other and the process resolves the peer, so core code never names `{{specifier}}` directly.",
    },
    deadAlias: {
      what: "`{{specifier}}` is a deleted alias (`~/`, `@app/`, `@ee/`); nothing resolves it any more.",
      fix: "Import the module by its package name — `@langwatch/<feature>-<contract|process|browser|browser-kit>` for a module package, `@langwatch/<name>` for any other workspace package — or by a relative path when it already lives inside this package.",
    },
    prismaContainment: {
      what: "`{{specifier}}` is Prisma, which only a server repository under `src/repositories/prisma/` may import.",
      fix: "Move the query into `repositories/prisma/prisma.<subject>.repository.ts`, behind the `repositories/<subject>.repository.ts` interface, and call that interface from the service.",
    },
    featureLayer: {
      what: "`{{layer}}` cannot import `{{targetLayer}}` (`{{specifier}}`).",
      fix: "Take the collaborator as a constructor parameter typed by its interface and let `app/<feature>.app.ts` pass the concrete one in. Where the target is the api or migrations layer, invert the call instead so that outer layer calls this one.",
    },
    retiredPackageRuntime: {
      what: "`{{specifier}}` is a retired runtime or package entry point.",
      fix: "Import {{replacement}} instead.",
    },
    schemaBoundary: {
      what: "`{{specifier}}` binds the contract to Hono.",
      fix: "Export a plain Zod/Standard Schema and let the transport adapt it.",
    },
    sealedExports: {
      what: "`{{subpath}}` is not in `{{package}}`'s `exports`.",
      fix: 'Import from `{{package}}` itself when its entry already re-exports the symbol; otherwise add `"{{subpath}}"` to the `exports` map in `{{package}}`\'s package.json and re-export the symbol from the file that entry points at.',
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
          data: { specifier, replacement },
        });
        return;
      }

      if (specifier.startsWith(".")) {
        const packageRoot = packageRootForFile(filename, context.cwd);
        if (packageRoot) {
          const targetPath = resolve(dirname(filename), specifier);
          const escaped = relative(packageRoot, targetPath).startsWith("..");
          // Only when the target belongs to another workspace member: that is
          // the case the fix can name. A path into a directory no package owns
          // (dev/scripts, services/langevals) has no package name to replace it
          // with, and a rule whose fix cannot be followed reads as debt.
          const targetRoot = packageRootForFile(targetPath, context.cwd);
          const crossesIntoAMember =
            targetRoot !== undefined && targetRoot !== packageRoot && targetRoot !== context.cwd;
          if (escaped && crossesIntoAMember) {
            context.report({
              node,
              messageId: "packageEscape",
              data: {
                specifier,
                packageRoot: relative(context.cwd, packageRoot).split(sep).join("/"),
              },
            });
          }

          // Production sources only: a service's own unit test composes it with
          // the real adapter or repository it runs against, which is the point of
          // the test rather than a layering breach.
          const appliesLayeringRules =
            !escaped && productionSource && classification.role === "server";

          if (appliesLayeringRules) {
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
                data: {
                  specifier,
                  layer: "api",
                  targetLayer: "the persistence or infrastructure layer",
                },
              });
            } else if (serviceImportsOuterLayer) {
              context.report({
                node,
                messageId: "featureLayer",
                data: { specifier, layer: "service", targetLayer: "the api or migrations layer" },
              });
            } else if (serviceImportsConcreteAdapter) {
              context.report({
                node,
                messageId: "featureLayer",
                data: { specifier, layer: "service", targetLayer: "a concrete adapter" },
              });
            }
          }
        }
      }

      if (target) {
        const subpath = packageSubpath(specifier, target.name);
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
        const targetExports = target.pkg.exports;
        if (!targetExports.has(subpath)) {
          context.report({
            node,
            messageId: "sealedExports",
            data: { subpath, package: target.name },
          });
        }

        const crossesFeatureBoundary =
          classification.feature &&
          target.pkg.feature !== classification.feature &&
          target.pkg.role !== "contract" &&
          !testSupportImport &&
          !webSurfaceImport;

        if (crossesFeatureBoundary) {
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
          context.report({ node, messageId: "coreImportsEnterprise", data: { specifier } });
        }
        if (classification.role === "contract" && target.pkg.role !== "contract") {
          context.report({ node, messageId: "contractRuntime", data: { specifier } });
        }
        if (classification.role === "web" && target.pkg.role === "server") {
          context.report({ node, messageId: "webImportsServer", data: { specifier } });
        }
        if (classification.role === "server" && target.pkg.role === "web") {
          context.report({ node, messageId: "serverImportsBrowser", data: { specifier } });
        }
        const importsServerOutsideCompositionRoot =
          classification.role === "other" &&
          target.pkg.role === "server" &&
          !isFeatureServerCompositionRoot(classification.workspacePath) &&
          !testSupportImport;

        if (importsServerOutsideCompositionRoot) {
          context.report({ node, messageId: "compositionRoot", data: { specifier } });
        }
      }

      const prismaImport =
        specifier === "@prisma/client" ||
        /generated\/prisma|generated-prisma|prisma\/client/.test(specifier);
      if (prismaImport && classification.feature) {
        const allowed =
          classification.role === "server" &&
          /\/src\/repositories\/prisma\//.test(`/${classification.workspacePath}`);
        if (!allowed) {
          context.report({ node, messageId: "prismaContainment", data: { specifier } });
        }
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
      const contractImportsRuntime =
        productionSource &&
        classification.role === "contract" &&
        (nodeRuntime || browserRuntime || serverRuntime);

      if (contractImportsRuntime) {
        context.report({ node, messageId: "contractRuntime", data: { specifier } });
      }

      const webImportsServerRuntime =
        productionSource && classification.role === "web" && (nodeRuntime || serverRuntime);

      if (webImportsServerRuntime) {
        context.report({ node, messageId: "webImportsServer", data: { specifier } });
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
        const isRequireStringLiteralCall =
          node.callee.type === "Identifier" &&
          node.callee.name === "require" &&
          node.arguments[0]?.type === "Literal";

        if (isRequireStringLiteralCall) {
          reportImport(node.arguments[0], node.arguments[0].value);
        }
      },
    };
  },
});
