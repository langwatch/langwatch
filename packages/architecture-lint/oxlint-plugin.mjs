import { existsSync, readFileSync, readdirSync } from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

const workspaceCache = new Map();
const featureLayoutCache = new Map();

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

function normalizedFilename(context) {
  const filename = context.physicalFilename || context.filename;
  return isAbsolute(filename) ? filename : resolve(context.cwd, filename);
}

function featureLayoutVersion(cwd, enterprise, feature) {
  const key = `${cwd}:${enterprise ? "enterprise:" : "core:"}${feature}`;
  if (featureLayoutCache.has(key)) return featureLayoutCache.get(key);
  const root = enterprise
    ? join(cwd, "packages", "enterprise", "features", feature)
    : join(cwd, "packages", "features", feature);
  const path = join(root, "feature.json");
  let version;
  if (existsSync(path)) {
    try {
      const value = JSON.parse(readFileSync(path, "utf8"));
      if (value.layoutVersion === 0) {
        version = value.layoutVersion;
      }
    } catch {
      version = undefined;
    }
  }
  featureLayoutCache.set(key, version);
  return version;
}

function classifyFile(filename, cwd) {
  const normalized = relative(cwd, filename).split(sep).join("/");
  const feature = normalized.match(
    /^packages\/(enterprise\/)?features\/([^/]+)\/(contract|server|web)\/(.+)$/,
  );
  if (feature) {
    const enterprise = Boolean(feature[1]);
    const packageRelative = feature[4];
    if (!/^(src|tests)\//.test(packageRelative)) {
      return { role: "other", workspacePath: normalized };
    }
    return {
      enterprise,
      feature: feature[2],
      layoutVersion: featureLayoutVersion(cwd, enterprise, feature[2]),
      relative: packageRelative,
      role: feature[3],
      workspacePath: normalized,
    };
  }
  if (
    /^packages\/(config|design-system|eventing|group-queue)\//.test(normalized)
  ) {
    const role = normalized.startsWith("packages/design-system/")
      ? "design-system"
      : normalized.startsWith("packages/config/")
        ? "config"
        : "framework";
    return { role, workspacePath: normalized };
  }
  return { role: "other", workspacePath: normalized };
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
  ["zod/v4", "zod"],
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

const boundaryRule = {
  meta: {
    type: "problem",
    messages: {
      compositionRoot:
        "Feature server packages may be imported only by app or worker runtime composition roots.",
      crossFeature:
        "Cross-feature collaboration must use the owning feature's contract package.",
      packageEscape:
        "A relative import cannot escape its physical workspace package.",
      packageRole:
        "This dependency is not allowed in the current package role.",
      prismaContainment:
        "Prisma may be imported only by a server repository adapter under src/repositories/prisma.",
      featureLayer:
        "Strict feature layers point toward the service contract: APIs cannot import persistence or infrastructure, and services cannot import APIs, migrations, or concrete adapters.",
      retiredPackageRuntime:
        "This package entry point belongs to a retired runtime or package surface; use {{replacement}}.",
      schemaBoundary:
        "Feature contracts remain transport-neutral; use the root hono-openapi API and Standard Schema instead of a Hono-specific schema adapter.",
      sealedExports:
        "This package subpath is not declared in the target package's exports map.",
    },
  },
  create(context) {
    const filename = normalizedFilename(context);
    const classification = classifyFile(filename, context.cwd);
    const workspace = loadWorkspace(context.cwd);
    const productionSource =
      !/(\/__tests__\/|\/tests\/|\.(test|unit|integration)\.)/.test(
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
          if (escaped) context.report({ node, messageId: "packageEscape" });

          if (
            !escaped &&
            classification.layoutVersion === 0 &&
            classification.role === "server"
          ) {
            const targetWorkspacePath = relative(context.cwd, targetPath)
              .split(sep)
              .join("/");
            const importer = classification.workspacePath;
            const apiImportsImplementation =
              /\/server\/src\/api\//.test(importer) &&
              /\/server\/src\/(?:adapters|migrations|projections|repositories|stores)\//.test(
                `/${targetWorkspacePath}`,
              );
            const serviceImportsOuterLayer =
              /\/server\/src\/services\//.test(importer) &&
              /\/server\/src\/(?:api|migrations)\//.test(
                `/${targetWorkspacePath}`,
              );
            const serviceImportsConcreteAdapter =
              /\/server\/src\/services\//.test(importer) &&
              /\/server\/src\/(?:adapters\/|repositories\/[^/]+\/|stores\/[^/]+\/)/.test(
                `/${targetWorkspacePath}`,
              );
            if (
              apiImportsImplementation ||
              serviceImportsOuterLayer ||
              serviceImportsConcreteAdapter
            ) {
              context.report({ node, messageId: "featureLayer" });
            }
          }
        }
      }

      if (target) {
        const subpath = packageSubpath(specifier, target.name);
        if (!target.pkg.exports.has(subpath)) {
          context.report({ node, messageId: "sealedExports" });
        }
        if (
          classification.feature &&
          target.pkg.feature !== classification.feature &&
          target.pkg.role !== "contract"
        ) {
          context.report({ node, messageId: "crossFeature" });
        }
        if (
          !classification.enterprise &&
          classification.role !== "other" &&
          target.pkg.enterprise
        ) {
          context.report({ node, messageId: "packageRole" });
        }
        if (
          classification.role === "contract" &&
          target.pkg.role !== "contract"
        ) {
          context.report({ node, messageId: "packageRole" });
        }
        if (classification.role === "web" && target.pkg.role === "server") {
          context.report({ node, messageId: "packageRole" });
        }
        if (classification.role === "server" && target.pkg.role === "web") {
          context.report({ node, messageId: "packageRole" });
        }
        if (
          classification.role === "other" &&
          target.pkg.role === "server" &&
          !/^platform\/app\/src\/runtime\/(app|worker)\//.test(
            classification.workspacePath,
          )
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
          /\/src\/repositories\/prisma\//.test(
            `/${classification.workspacePath}`,
          );
        if (!allowed) context.report({ node, messageId: "prismaContainment" });
      }

      if (
        classification.feature &&
        (specifier === "@hono/zod-validator" ||
          specifier === "hono-openapi/zod")
      ) {
        context.report({ node, messageId: "schemaBoundary" });
      }

      const nodeRuntime = specifier.startsWith("node:");
      const browserRuntime = /^(react|react-dom|@chakra-ui\/)/.test(specifier);
      const serverRuntime =
        /^(hono|@trpc\/server|@langwatch\/(eventing|group-queue))/.test(
          specifier,
        );
      if (
        productionSource &&
        classification.role === "contract" &&
        (nodeRuntime || browserRuntime || serverRuntime)
      ) {
        context.report({ node, messageId: "packageRole" });
      }
      if (
        productionSource &&
        classification.role === "web" &&
        (nodeRuntime || serverRuntime)
      ) {
        context.report({ node, messageId: "packageRole" });
      }
      if (
        productionSource &&
        classification.role === "server" &&
        browserRuntime
      ) {
        context.report({ node, messageId: "packageRole" });
      }
      if (
        productionSource &&
        classification.role !== "other" &&
        (/^(~\/|@app\/|@ee\/)/.test(specifier) ||
          specifier.includes("platform/app"))
      ) {
        context.report({ node, messageId: "packageRole" });
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
};

const environmentBoundariesRule = {
  meta: {
    type: "problem",
    messages: {
      environment:
        "Feature and framework packages receive typed configuration; they must not read environment variables directly.",
    },
  },
  create(context) {
    const filename = normalizedFilename(context);
    const classification = classifyFile(filename, context.cwd);
    const governed =
      classification.feature ||
      classification.role === "config" ||
      classification.role === "design-system";
    const productionSource =
      !/(\/__tests__\/|\/tests\/|\.(test|unit|integration)\.)/.test(
        classification.workspacePath,
      );
    if (!governed || !productionSource) return {};

    return {
      MemberExpression(node) {
        const isProcessEnv =
          node.object.type === "Identifier" &&
          node.object.name === "process" &&
          node.property.type === "Identifier" &&
          node.property.name === "env";
        const isImportMetaEnv =
          node.object.type === "MetaProperty" &&
          node.property.type === "Identifier" &&
          node.property.name === "env";
        if (isProcessEnv || isImportMetaEnv) {
          context.report({ node, messageId: "environment" });
        }
      },
    };
  },
};

const serviceClassesRule = {
  meta: {
    type: "suggestion",
    messages: {
      create:
        "A service class must expose construction through a static create method.",
      missing:
        "A service module must define a class whose name ends in Service.",
      standalone:
        "Service modules keep behaviour on the service class, not in standalone functions.",
    },
  },
  create(context) {
    const filename = normalizedFilename(context);
    const normalized = relative(context.cwd, filename).split(sep).join("/");
    if (
      !/^packages\/(enterprise\/)?features\/[^/]+\/server\/src\/services\//.test(
        normalized,
      )
    ) {
      return {};
    }
    return {
      Program(node) {
        const classes = [];
        for (const statement of node.body) {
          let declaration = statement;
          const exported =
            statement.type === "ExportNamedDeclaration" ||
            statement.type === "ExportDefaultDeclaration";
          if (
            statement.type === "ExportNamedDeclaration" &&
            statement.declaration
          ) {
            declaration = statement.declaration;
          }
          if (
            statement.type === "ExportDefaultDeclaration" &&
            statement.declaration
          ) {
            declaration = statement.declaration;
          }
          if (exported && declaration.type === "FunctionDeclaration") {
            context.report({ node: declaration, messageId: "standalone" });
          }
          if (exported && declaration.type === "VariableDeclaration") {
            for (const item of declaration.declarations) {
              if (
                item.init?.type === "ArrowFunctionExpression" ||
                item.init?.type === "FunctionExpression"
              ) {
                context.report({ node: item, messageId: "standalone" });
              }
            }
          }
          if (
            exported &&
            declaration.type === "ClassDeclaration" &&
            declaration.id?.name.endsWith("Service")
          ) {
            classes.push(declaration);
          }
        }
        if (classes.length === 0) {
          context.report({ node, messageId: "missing" });
          return;
        }
        for (const serviceClass of classes) {
          const hasStaticCreate = serviceClass.body.body.some(
            (member) =>
              member.type === "MethodDefinition" &&
              member.static &&
              member.key.type === "Identifier" &&
              member.key.name === "create",
          );
          if (!hasStaticCreate) {
            context.report({ node: serviceClass, messageId: "create" });
          }
        }
      },
    };
  },
};

function declaredClasses(program) {
  const classes = [];
  const functions = [];
  for (const statement of program.body) {
    let declaration = statement;
    const exported =
      statement.type === "ExportNamedDeclaration" ||
      statement.type === "ExportDefaultDeclaration";
    if (statement.type === "ExportNamedDeclaration" && statement.declaration) {
      declaration = statement.declaration;
    }
    if (
      statement.type === "ExportDefaultDeclaration" &&
      statement.declaration
    ) {
      declaration = statement.declaration;
    }
    if (exported && declaration.type === "ClassDeclaration") {
      classes.push(declaration);
    }
    if (exported && declaration.type === "FunctionDeclaration") {
      functions.push(declaration);
    }
    if (exported && declaration.type === "VariableDeclaration") {
      for (const item of declaration.declarations) {
        if (
          item.init?.type === "ArrowFunctionExpression" ||
          item.init?.type === "FunctionExpression"
        ) {
          functions.push(item);
        }
      }
    }
  }
  return { classes, functions };
}

function featureModuleKind(normalized) {
  const contract = normalized.match(
    /^packages\/(?:enterprise\/)?features\/[^/]+\/contract\/src\/.+\.service\.ts$/,
  );
  if (contract) return { suffix: "Service", abstract: true, concrete: false };

  const server = normalized.match(
    /^packages\/(?:enterprise\/)?features\/[^/]+\/server\/src\/(.+)$/,
  );
  if (!server) return undefined;
  const path = server[1];
  if (/^api\/[^/]+\/.+\.api\.ts$/.test(path)) {
    return { suffix: "Api", abstract: false, concrete: true };
  }
  if (/^migrations\/.+\.migration\.ts$/.test(path)) {
    return { suffix: "Migration", abstract: false, concrete: true };
  }
  if (/^projections\/.+\.projection\.ts$/.test(path)) {
    return { suffix: "Projection", abstract: false, concrete: true };
  }
  if (/^adapters\/.+\.adapter\.ts$/.test(path)) {
    return { suffix: "Adapter", abstract: false, concrete: true };
  }
  if (/^repositories\/[^/]+\.repository\.ts$/.test(path)) {
    return { suffix: "Repository", abstract: true, concrete: false };
  }
  if (/^repositories\/[^/]+\/.+\.repository\.ts$/.test(path)) {
    return { suffix: "Repository", abstract: false, concrete: true };
  }
  if (/^stores\/[^/]+\.store\.ts$/.test(path)) {
    return { suffix: "Store", abstract: true, concrete: false };
  }
  if (/^stores\/[^/]+\/.+\.store\.ts$/.test(path)) {
    return { suffix: "Store", abstract: false, concrete: true };
  }
  return undefined;
}

const featureModuleClassesRule = {
  meta: {
    type: "problem",
    messages: {
      abstract:
        "A strict feature port module must export an abstract {{suffix}} class.",
      concrete:
        "A strict feature runtime module must export a concrete {{suffix}} class.",
      create:
        "A concrete strict feature class must expose construction through static create.",
      standalone:
        "Behaviour-bearing strict feature modules keep factories and behaviour on their class.",
    },
  },
  create(context) {
    const filename = normalizedFilename(context);
    const classification = classifyFile(filename, context.cwd);
    if (classification.layoutVersion !== 0) return {};
    const normalized = relative(context.cwd, filename).split(sep).join("/");
    const kind = featureModuleKind(normalized);
    if (!kind) return {};

    return {
      Program(node) {
        const declarations = declaredClasses(node);
        for (const fn of declarations.functions) {
          context.report({ node: fn, messageId: "standalone" });
        }
        const matching = declarations.classes.filter((candidate) =>
          candidate.id?.name.endsWith(kind.suffix),
        );
        const valid = matching.filter((candidate) =>
          kind.abstract ? candidate.abstract : !candidate.abstract,
        );
        if (valid.length === 0) {
          context.report({
            node,
            messageId: kind.abstract ? "abstract" : "concrete",
            data: { suffix: kind.suffix },
          });
          return;
        }
        if (!kind.concrete) return;
        for (const candidate of valid) {
          const hasStaticCreate = candidate.body.body.some(
            (member) =>
              member.type === "MethodDefinition" &&
              member.static &&
              member.key.type === "Identifier" &&
              member.key.name === "create",
          );
          if (!hasStaticCreate) {
            context.report({ node: candidate, messageId: "create" });
          }
        }
      },
    };
  },
};

function serviceSubject(filename) {
  const name = basename(filename);
  return name.endsWith(".service.ts")
    ? name.slice(0, -".service.ts".length)
    : undefined;
}

function serviceOwnerRoot(filename, cwd) {
  const normalized = relative(cwd, filename).split(sep).join("/");
  const feature = normalized.match(
    /^(packages\/(?:enterprise\/)?features\/[^/]+\/server)\/src\/services\//,
  );
  if (feature) return resolve(cwd, feature[1]);
  const application = normalized.match(
    /^(platform\/app\/src\/server\/(?:app-layer\/)?[^/]+)\//,
  );
  return application ? resolve(cwd, application[1]) : dirname(filename);
}

function repositoryTarget(specifier, filename, cwd) {
  if (specifier.startsWith(".")) return resolve(dirname(filename), specifier);
  if (specifier.startsWith("~/")) {
    return resolve(cwd, "platform/app/src", specifier.slice(2));
  }
  return undefined;
}

function importedName(specifier) {
  if (specifier.type === "ImportSpecifier") {
    return specifier.imported.name ?? specifier.imported.value;
  }
  return specifier.local?.name;
}

function importsRepository(node) {
  const pathNamesRepository = node.source.value
    .split("/")
    .at(-1)
    ?.replace(/\.[cm]?[jt]s$/, "")
    .endsWith(".repository");
  return (
    pathNamesRepository ||
    node.specifiers.some((specifier) =>
      importedName(specifier)?.endsWith("Repository"),
    )
  );
}

function importsDatabaseClient(node) {
  const specifier = node.source.value;
  return (
    specifier === "@prisma/client" ||
    specifier === "@clickhouse/client" ||
    specifier === "ioredis" ||
    specifier === "redis" ||
    /(?:generated\/prisma|prisma\/client|\/clickhouse(?:\/|$)|\/redis(?:\/|$)|\/db(?:\/|$))/.test(
      specifier,
    ) ||
    node.specifiers.some((item) =>
      /(?:PrismaClient|ClickHouseClient|RedisClient)$/.test(
        importedName(item) ?? "",
      ),
    )
  );
}

function importsGlobalApplication(node) {
  return (
    /(?:^|\/)app-layer\/app$/.test(node.source.value) ||
    node.specifiers.some((item) =>
      /^(?:getApp|tryGetApp|initializeApp)$/.test(importedName(item) ?? ""),
    )
  );
}

function escapesRoot(root, target) {
  const path = relative(root, target);
  return path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path);
}

const serviceDependenciesRule = {
  meta: {
    type: "problem",
    messages: {
      databaseClient:
        "A service cannot import a database client; persistence belongs behind its own repository.",
      foreignRepository:
        "A service may depend on its own repository and on other services; it must not depend on another subject's repository.",
      globalApplication:
        "A service cannot recover the global application graph; inject the service dependency explicitly.",
    },
  },
  create(context) {
    const filename = normalizedFilename(context);
    const subject = serviceSubject(filename);
    if (!subject) return {};
    const ownerRoot = serviceOwnerRoot(filename, context.cwd);

    return {
      ImportDeclaration(node) {
        if (importsDatabaseClient(node)) {
          context.report({ node: node.source, messageId: "databaseClient" });
        }
        if (importsGlobalApplication(node)) {
          context.report({ node: node.source, messageId: "globalApplication" });
        }
        if (!importsRepository(node)) return;
        const target = repositoryTarget(
          node.source.value,
          filename,
          context.cwd,
        );
        if (!target || escapesRoot(ownerRoot, target)) {
          context.report({ node: node.source, messageId: "foreignRepository" });
        }
      },
    };
  },
};

function isFeatureApi(classification) {
  return (
    classification.role === "server" &&
    /^src\/api\/[^/]+\/.+\.api\.ts$/.test(classification.relative ?? "")
  );
}

function identifierName(node) {
  return node?.type === "Identifier" ? node.name : undefined;
}

function isContextIdentifier(node) {
  return ["c", "ctx", "context"].includes(identifierName(node));
}

function isOptionsMethodCall(node) {
  if (node.callee.type !== "MemberExpression") return false;
  const owner = node.callee.object;
  return (
    owner.type === "MemberExpression" &&
    owner.object.type === "ThisExpression" &&
    !owner.computed &&
    identifierName(owner.property) === "options"
  );
}

const apiContextServicesRule = {
  meta: {
    type: "problem",
    messages: {
      contextCast:
        "API context is already typed; do not cast it to recover application services.",
      construction:
        "API classes delegate through context.app; they do not construct services, repositories, stores, or adapters.",
      doubleAwait:
        "Await one service call; do not await a resolver and then await the service operation.",
      resolver:
        "API options are static configuration, not per-request callbacks; use context.app, context.actor(), context.authorize(), and validated input.",
    },
  },
  create(context) {
    const filename = normalizedFilename(context);
    const classification = classifyFile(filename, context.cwd);
    if (!isFeatureApi(classification)) return {};

    return {
      AwaitExpression(node) {
        const nestedAwait =
          node.argument.type === "AwaitExpression" ||
          (node.argument.type === "CallExpression" &&
            node.argument.callee.type === "MemberExpression" &&
            node.argument.callee.object.type === "AwaitExpression");
        if (nestedAwait) {
          context.report({ node, messageId: "doubleAwait" });
        }
      },
      CallExpression(node) {
        if (isOptionsMethodCall(node)) {
          context.report({ node, messageId: "resolver" });
        }
      },
      NewExpression(node) {
        const name = identifierName(node.callee);
        if (name && /(Service|Repository|Store|Adapter)$/.test(name)) {
          context.report({ node, messageId: "construction" });
        }
      },
      TSAsExpression(node) {
        if (isContextIdentifier(node.expression)) {
          context.report({ node, messageId: "contextCast" });
        }
      },
    };
  },
};

export const rules = {
  "api-context-services": apiContextServicesRule,
  "environment-boundaries": environmentBoundariesRule,
  "package-boundaries": boundaryRule,
  "feature-module-classes": featureModuleClassesRule,
  "service-classes": serviceClassesRule,
  "service-dependencies": serviceDependenciesRule,
};

export default {
  meta: { name: "eslint-plugin-langwatch", version: "0.1.0" },
  rules,
};
