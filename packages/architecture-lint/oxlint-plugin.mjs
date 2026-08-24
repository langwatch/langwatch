import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

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

const boundaryRule = {
  meta: {
    type: "problem",
    messages: {
      compositionRoot:
        "Feature server packages may be imported only by app or worker runtime composition roots.",
      crossFeature:
        "Cross-feature collaboration must use the owning feature's contract package.",
      environment:
        "Feature and framework packages receive typed configuration; they must not read environment variables directly.",
      packageEscape:
        "A relative import cannot escape its physical workspace package.",
      packageRole:
        "This dependency is not allowed in the current package role.",
      prismaContainment:
        "Prisma may be imported only by a server repository adapter under src/repositories/prisma.",
      featureLayer:
        "Strict feature layers point toward the service contract: APIs cannot import persistence or infrastructure, and services cannot import APIs, migrations, or concrete adapters.",
      schemaBoundary:
        "Feature packages use Zod 4 through Standard Schema; import from zod and the root hono-openapi API.",
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
        (specifier === "zod/v3" ||
          specifier === "@hono/zod-validator" ||
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
      MemberExpression(node) {
        if (!productionSource) return;
        if (
          !classification.feature &&
          classification.role !== "config" &&
          classification.role !== "design-system"
        ) {
          return;
        }
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

const noConditionalSpreadRule = {
  meta: {
    type: "suggestion",
    messages: {
      conditional:
        "Build optional fields with explicit statements; do not hide control flow in an object spread.",
    },
  },
  create(context) {
    const filename = normalizedFilename(context);
    const classification = classifyFile(filename, context.cwd);
    if (classification.role !== "server") return {};
    return {
      SpreadElement(node) {
        if (
          node.argument.type === "ConditionalExpression" ||
          node.argument.type === "LogicalExpression"
        ) {
          context.report({ node, messageId: "conditional" });
        }
      },
    };
  },
};

export const rules = {
  "package-boundaries": boundaryRule,
  "feature-module-classes": featureModuleClassesRule,
  "service-classes": serviceClassesRule,
  "no-conditional-spread": noConditionalSpreadRule,
};

export default {
  meta: { name: "eslint-plugin-langwatch", version: "0.1.0" },
  rules,
};
