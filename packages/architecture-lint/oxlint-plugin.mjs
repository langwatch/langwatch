import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

const workspaceCache = new Map();
const featureLayoutCache = new Map();
const strictPortBaselineCache = new Map();

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

function isStrictServiceModule(filename, cwd) {
  const normalized = relative(cwd, filename).split(sep).join("/");
  return /^packages\/(enterprise\/)?features\/[^/]+\/server\/src\/services\/.+\.service\.ts$/.test(
    normalized,
  );
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

function strictPortBaseline(cwd) {
  const cached = strictPortBaselineCache.get(cwd);
  if (cached) return cached;
  const file = join(
    cwd,
    "packages",
    "architecture-lint",
    "src",
    "port-module-baseline.json",
  );
  let ports = new Set();
  if (existsSync(file)) {
    try {
      const value = JSON.parse(readFileSync(file, "utf8"));
      if (
        value.version === 0 &&
        Array.isArray(value.ports) &&
        value.ports.every((port) => typeof port === "string")
      ) {
        ports = new Set(value.ports);
      }
    } catch {
      ports = new Set();
    }
  }
  strictPortBaselineCache.set(cwd, ports);
  return ports;
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
  if (/^packages\/(config|design-system|eventing|group-queue)\//.test(normalized)) {
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
      packageEscape: "A relative import cannot escape its physical workspace package.",
      packageRole: "This dependency is not allowed in the current package role.",
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
              /\/server\/src\/(?:api|migrations)\//.test(`/${targetWorkspacePath}`);
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
        if (classification.role === "contract" && target.pkg.role !== "contract") {
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
          /\/src\/repositories\/prisma\//.test(`/${classification.workspacePath}`);
        if (!allowed) context.report({ node, messageId: "prismaContainment" });
      }

      if (
        classification.feature &&
        (specifier === "@hono/zod-validator" || specifier === "hono-openapi/zod")
      ) {
        context.report({ node, messageId: "schemaBoundary" });
      }

      const nodeRuntime = specifier.startsWith("node:");
      const browserRuntime = /^(react|react-dom|@chakra-ui\/)/.test(specifier);
      const serverRuntime =
        /^(hono|@trpc\/server|@langwatch\/(eventing|group-queue))/.test(specifier);
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
      if (productionSource && classification.role === "server" && browserRuntime) {
        context.report({ node, messageId: "packageRole" });
      }
      if (
        productionSource &&
        classification.role !== "other" &&
        (/^(~\/|@app\/|@ee\/)/.test(specifier) || specifier.includes("platform/app"))
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
      create: "A service class must expose construction through a static create method.",
      missing: "A service module must define a class whose name ends in Service.",
      standalone:
        "Service modules keep behaviour on the service class, not in standalone functions.",
    },
  },
  create(context) {
    const filename = normalizedFilename(context);
    if (!isStrictServiceModule(filename, context.cwd)) {
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
          if (statement.type === "ExportNamedDeclaration" && statement.declaration) {
            declaration = statement.declaration;
          }
          if (statement.type === "ExportDefaultDeclaration" && statement.declaration) {
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

function memberName(member) {
  if (!member.key) return undefined;
  if (member.computed && member.key.type === "Literal") {
    return String(member.key.value);
  }
  if (member.computed) return undefined;
  if (member.key.type === "Identifier" || member.key.type === "PrivateIdentifier") {
    return member.key.name;
  }
  if (member.key.type === "Literal") return String(member.key.value);
  return undefined;
}

function objectKeyName(property) {
  if (property.type === "SpreadElement") return undefined;
  if (property.computed && property.key?.type === "Literal") {
    return String(property.key.value);
  }
  if (property.computed) return undefined;
  if (property.key?.type === "Identifier") return property.key.name;
  if (property.key?.type === "Literal") return String(property.key.value);
  return undefined;
}

function maskClassSource(source) {
  return source.replace(
    /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\/\/[^\r\n]*|\/\*[\s\S]*?\*\/)/g,
    (value) => " ".repeat(value.length),
  );
}

function sourceMethodNames(source, classBody) {
  if (!classBody.range) return new Map();
  const classSource = source.slice(classBody.range[0] + 1, classBody.range[1] - 1);
  const masked = maskClassSource(classSource);
  const names = new Map();
  const depthAt = (index) => {
    let depth = 0;
    for (let cursor = 0; cursor < index; cursor += 1) {
      if (masked[cursor] === "{") depth += 1;
      if (masked[cursor] === "}") depth -= 1;
    }
    return depth;
  };
  const add = (name, index) => {
    if (depthAt(index) !== 0 || name === "constructor") return;
    const entries = names.get(name) ?? [];
    entries.push(index);
    names.set(name, entries);
  };
  const normal =
    /\b([A-Za-z_$][\w$]*)\s*(?:<[^>{}]*>)?\s*\([^)]*\)\s*(?::[^{};]+)?\s*(?:\{|;)/g;
  for (const match of masked.matchAll(normal)) add(match[1], match.index);
  const computed =
    /\[\s*(["'])([^"']+)\1\s*\]\s*(?:<[^>{}]*>)?\s*\([^)]*\)\s*(?::[^{};]+)?\s*(?:\{|;)/g;
  for (const match of classSource.matchAll(computed)) add(match[2], match.index);
  return names;
}

const serviceQualityRule = {
  meta: {
    type: "problem",
    messages: {
      duplicateMember:
        "A service class cannot declare the member {{name}} more than once.",
      duplicateObjectKey:
        "A service object literal cannot declare the key {{name}} more than once.",
      publicConstructor:
        "Concrete services with static create must keep their constructor private.",
    },
  },
  create(context) {
    const filename = normalizedFilename(context);
    if (!isStrictServiceModule(filename, context.cwd)) return {};

    return {
      ClassBody(node) {
        const names = new Map();
        for (const member of node.body) {
          const name = memberName(member);
          if (!name || name === "constructor") continue;
          const accessor = member.kind === "get" || member.kind === "set";
          const key = `${member.static ? "static" : "instance"}:${name}`;
          const prior = names.get(key);
          const overloadPair =
            prior &&
            member.type === "MethodDefinition" &&
            prior.type === "MethodDefinition" &&
            !prior.value?.body;
          if (
            prior &&
            !overloadPair &&
            !(accessor && prior.accessor && prior.kind !== member.kind)
          ) {
            context.report({
              node: member,
              messageId: "duplicateMember",
              data: { name },
            });
          }
          names.set(key, member);
        }
        // Oxc drops an earlier duplicate class method while recovering from
        // the parser's duplicate-member early error. Recover that case from
        // the class source so the rule remains useful on real files.
        for (const [name, occurrences] of sourceMethodNames(
          context.sourceCode.text,
          node,
        )) {
          if (occurrences.length < 2) continue;
          const astMatches = node.body.filter((member) => memberName(member) === name);
          if (astMatches.length > 1) continue;
          context.report({
            node: astMatches[0] ?? node,
            messageId: "duplicateMember",
            data: { name },
          });
        }
      },
      ClassDeclaration(node) {
        if (!node.id?.name.endsWith("Service") || node.abstract) return;
        const hasStaticCreate = node.body.body.some(
          (member) =>
            member.type === "MethodDefinition" &&
            member.static &&
            memberName(member) === "create",
        );
        if (!hasStaticCreate) return;
        const constructor = node.body.body.find(
          (member) => member.type === "MethodDefinition" && member.kind === "constructor",
        );
        if (
          constructor &&
          (!constructor.accessibility || constructor.accessibility === "public")
        ) {
          context.report({ node: constructor, messageId: "publicConstructor" });
        }
      },
      ObjectExpression(node) {
        const keys = new Set();
        for (const property of node.properties) {
          const key = objectKeyName(property);
          if (!key) continue;
          if (keys.has(key)) {
            context.report({
              node: property,
              messageId: "duplicateObjectKey",
              data: { name: key },
            });
          }
          keys.add(key);
        }
      },
    };
  },
};

const maxStatementsPerLineRule = {
  meta: {
    type: "problem",
    messages: {
      maxStatementsPerLine:
        "A service block cannot place more than one statement on a physical line.",
    },
  },
  create(context) {
    const filename = normalizedFilename(context);
    if (!isStrictServiceModule(filename, context.cwd)) return {};

    return {
      BlockStatement(node) {
        const statementByLine = new Map();
        for (const statement of node.body) {
          const line = statement.loc.start.line;
          const prior = statementByLine.get(line);
          if (prior) {
            context.report({ node: statement, messageId: "maxStatementsPerLine" });
          }
          statementByLine.set(line, statement);
        }
      },
    };
  },
};

const serviceMemberSpacingRule = {
  meta: {
    type: "layout",
    fixable: "whitespace",
    messages: {
      memberSpacing:
        "Consecutive service methods, constructors, and accessors need one blank line between them.",
    },
  },
  create(context) {
    const filename = normalizedFilename(context);
    if (!isStrictServiceModule(filename, context.cwd)) return {};
    const source = context.sourceCode.text;
    const newline = source.includes("\r\n") ? "\r\n" : "\n";

    return {
      ClassBody(node) {
        const methods = node.body.filter(
          (member) => member.type === "MethodDefinition" && member.range,
        );
        for (let index = 1; index < methods.length; index += 1) {
          const previous = methods[index - 1];
          const member = methods[index];
          if (!previous?.range || !member?.range) continue;
          const between = source.slice(previous.range[1], member.range[0]);
          if (/\r?\n[ \t]*\r?\n/.test(between)) continue;
          context.report({
            node: member,
            messageId: "memberSpacing",
            fix(fixer) {
              return fixer.insertTextAfterRange(previous.range, newline);
            },
          });
        }
      },
    };
  },
};

function isTypePosition(node) {
  let current = node;
  let parent = node.parent;
  while (parent) {
    if (!parent.type?.startsWith("TS")) return false;
    // The expression side of an assertion remains runtime JavaScript. The
    // annotation/type-parameter side is handled by the generic TS branch.
    if (
      (parent.type === "TSAsExpression" ||
        parent.type === "TSTypeAssertion" ||
        parent.type === "TSNonNullExpression" ||
        parent.type === "TSSatisfiesExpression" ||
        parent.type === "TSInstantiationExpression") &&
      parent.expression === current
    ) {
      return false;
    }
    if (parent.type === "TSTypeQuery" && parent.exprName === current) return true;
    return true;
  }
  return false;
}

function isBindingPosition(node) {
  let current = node;
  let parent = node.parent;
  while (parent) {
    if (parent.type === "AssignmentPattern") return parent.left === current;
    if (parent.type === "RestElement") return true;
    if (parent.type === "VariableDeclarator") return parent.id === current;
    if (
      (parent.type === "FunctionDeclaration" ||
        parent.type === "FunctionExpression" ||
        parent.type === "ArrowFunctionExpression") &&
      parent.params.includes(current)
    ) {
      return true;
    }
    if (parent.type === "CatchClause" && parent.param === current) return true;
    if (parent.type === "Property" && parent.parent?.type === "ObjectPattern") {
      return true;
    }
    if (parent.type === "ObjectPattern" || parent.type === "ArrayPattern") return true;
    current = parent;
    parent = parent.parent;
  }
  return false;
}

function isNonValueIdentifier(node) {
  const parent = node.parent;
  if (!parent) return false;
  if (
    parent.type === "ImportSpecifier" ||
    parent.type === "ImportDefaultSpecifier" ||
    parent.type === "ImportNamespaceSpecifier" ||
    parent.type === "ExportSpecifier"
  ) {
    return true;
  }
  if (
    (parent.type === "MemberExpression" || parent.type === "OptionalMemberExpression") &&
    parent.property === node &&
    !parent.computed
  ) {
    return true;
  }
  if (
    (parent.type === "MethodDefinition" ||
      parent.type === "PropertyDefinition" ||
      parent.type === "TSPropertySignature" ||
      parent.type === "TSMethodSignature") &&
    parent.key === node &&
    !parent.computed
  ) {
    return true;
  }
  if (parent.type === "Property" && parent.key === node && !parent.computed) {
    // Object-literal shorthand is both key and value. It is fixed by
    // expanding the shorthand; object-pattern shorthand is a binding.
    if (parent.shorthand && parent.parent?.type === "ObjectExpression") {
      return parent.value !== node;
    }
    return true;
  }
  if (
    (parent.type === "LabeledStatement" ||
      parent.type === "BreakStatement" ||
      parent.type === "ContinueStatement") &&
    parent.label === node
  ) {
    return true;
  }
  if (parent.type === "TSQualifiedName" || parent.type === "TSTypeQuery") return true;
  return isBindingPosition(node) || isTypePosition(node);
}

const runtimeUndefinedRule = {
  meta: {
    type: "suggestion",
    fixable: "code",
    messages: {
      runtimeUndefined: "Use void 0 instead of the ambient undefined value.",
    },
  },
  create(context) {
    function hasUndefinedBinding(pattern) {
      if (!pattern) return false;
      if (pattern.type === "Identifier") return pattern.name === "undefined";
      if (pattern.type === "AssignmentPattern") return hasUndefinedBinding(pattern.left);
      if (pattern.type === "RestElement") return hasUndefinedBinding(pattern.argument);
      if (pattern.type === "ArrayPattern")
        return pattern.elements.some(hasUndefinedBinding);
      if (pattern.type === "ObjectPattern") {
        return pattern.properties.some((property) =>
          property.type === "RestElement"
            ? hasUndefinedBinding(property.argument)
            : hasUndefinedBinding(property.value),
        );
      }
      return false;
    }

    function declaresUndefined(statement) {
      const declaration =
        statement.type === "ExportNamedDeclaration" ? statement.declaration : statement;
      return (
        declaration?.type === "VariableDeclaration" &&
        declaration.declarations.some((item) => hasUndefinedBinding(item.id))
      );
    }

    // Oxc's plugin context does not expose ESLint's scope manager. Conservatively
    // skip a reference whenever an enclosing scope declares `undefined`.
    function isShadowedUndefined(node) {
      let current = node.parent;
      while (current) {
        if (
          (current.type === "FunctionDeclaration" ||
            current.type === "FunctionExpression" ||
            current.type === "ArrowFunctionExpression") &&
          current.params.some(hasUndefinedBinding)
        ) {
          return true;
        }
        if (current.type === "CatchClause" && hasUndefinedBinding(current.param))
          return true;
        if (
          (current.type === "BlockStatement" || current.type === "Program") &&
          current.body.some(declaresUndefined)
        ) {
          return true;
        }
        current = current.parent;
      }
      return false;
    }

    return {
      Identifier(node) {
        if (
          node.name !== "undefined" ||
          isNonValueIdentifier(node) ||
          isShadowedUndefined(node)
        ) {
          return;
        }
        context.report({
          node,
          messageId: "runtimeUndefined",
          fix(fixer) {
            const parent = node.parent;
            if (
              parent?.type === "Property" &&
              parent.shorthand &&
              parent.parent?.type === "ObjectExpression"
            ) {
              return fixer.replaceText(node, "undefined: void 0");
            }
            return fixer.replaceText(node, "void 0");
          },
        });
      },
    };
  },
};

const CONTROL_FLOW_STATEMENTS = new Set([
  "IfStatement",
  "ForStatement",
  "ForInStatement",
  "ForOfStatement",
  "WhileStatement",
  "DoWhileStatement",
  "TryStatement",
  "SwitchStatement",
]);

function hasBlankLine(source, previous, next) {
  return /\r?\n[ \t]*\r?\n/.test(source.slice(previous.range[1], next.range[0]));
}

const logicalStatementSpacingRule = {
  meta: {
    type: "layout",
    fixable: "whitespace",
    messages: {
      statementSpacing:
        "Separate control-flow statements and non-sole return/throw statements with one blank line.",
    },
  },
  create(context) {
    const source = context.sourceCode.text;
    const newline = source.includes("\r\n") ? "\r\n" : "\n";
    return {
      BlockStatement(node) {
        const statements = node.body;
        for (let index = 1; index < statements.length; index += 1) {
          const previous = statements[index - 1];
          const current = statements[index];
          const afterControlFlow = CONTROL_FLOW_STATEMENTS.has(previous.type);
          const beforeNonSoleExit =
            (current.type === "ReturnStatement" || current.type === "ThrowStatement") &&
            statements.length > 1;
          if (
            (!afterControlFlow && !beforeNonSoleExit) ||
            hasBlankLine(source, previous, current)
          ) {
            continue;
          }
          context.report({
            node: current,
            messageId: "statementSpacing",
            fix(fixer) {
              const between = source.slice(previous.range[1], current.range[0]);
              const lineBreaks = between.match(/\r?\n/g)?.length ?? 0;
              const firstLine = between.split(/\r?\n/, 1)[0] ?? "";
              const trailingComment = firstLine.match(
                /^[ \t]+(?:\/\/[^\r\n]*|\/\*[^]*?\*\/)[ \t]*$/,
              );
              const text = lineBreaks === 0 ? `${newline}${newline}` : newline;
              if (trailingComment) {
                const start = previous.range[1];
                const end = start + trailingComment[0].length;
                return fixer.insertTextAfterRange([start, end], text);
              }
              return fixer.insertTextAfterRange(previous.range, text);
            },
          });
        }
      },
    };
  },
};

function booleanLeafCount(node) {
  if (
    node.type !== "LogicalExpression" ||
    (node.operator !== "&&" && node.operator !== "||")
  ) {
    return 1;
  }
  return booleanLeafCount(node.left) + booleanLeafCount(node.right);
}

const booleanWallRule = {
  meta: {
    type: "problem",
    messages: {
      booleanWall:
        "Split boolean walls with more than three leaf conditions into named intermediate predicates.",
    },
  },
  create(context) {
    return {
      LogicalExpression(node) {
        if (
          node.parent?.type === "LogicalExpression" &&
          (node.parent.operator === "&&" || node.parent.operator === "||")
        ) {
          return;
        }
        if (booleanLeafCount(node) > 3) {
          context.report({ node, messageId: "booleanWall" });
        }
      },
    };
  },
};

function chainsOffAwait(node) {
  if (node.type === "AwaitExpression") return false;
  let current = node;
  while (current) {
    if (
      current.type === "MemberExpression" ||
      current.type === "OptionalMemberExpression"
    ) {
      if (current.object.type === "AwaitExpression") return true;
      current = current.object;
      continue;
    }
    if (current.type === "CallExpression" || current.type === "OptionalCallExpression") {
      if (
        current.callee.type === "MemberExpression" &&
        current.callee.object.type === "AwaitExpression"
      ) {
        return true;
      }
      current = current.callee;
      continue;
    }
    return false;
  }
  return false;
}

const awaitedReturnChainRule = {
  meta: {
    type: "problem",
    messages: {
      awaitedReturnChain:
        "Name the awaited result before chaining properties or calls from it.",
    },
  },
  create(context) {
    const filename = normalizedFilename(context);
    if (!isStrictServiceModule(filename, context.cwd)) return {};
    return {
      ReturnStatement(node) {
        if (node.argument && chainsOffAwait(node.argument)) {
          context.report({ node, messageId: "awaitedReturnChain" });
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
    if (statement.type === "ExportDefaultDeclaration" && statement.declaration) {
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

function hasInvalidExportedPort(program) {
  for (const statement of program.body) {
    if (statement.type !== "ExportNamedDeclaration" || !statement.declaration) {
      continue;
    }
    const declaration = statement.declaration;
    const name = declaration.id?.name;
    if (!name?.endsWith("Port")) {
      continue;
    }
    if (declaration.type !== "ClassDeclaration" || !declaration.abstract) {
      return true;
    }
  }
  return false;
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
  if (/^ports\/.+\.port\.ts$/.test(path)) {
    return { suffix: "Port", abstract: true, concrete: false };
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
      abstract: "A strict feature port module must export an abstract {{suffix}} class.",
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
        if (kind.suffix === "Port" && strictPortBaseline(context.cwd).has(normalized)) {
          return;
        }
        if (kind.suffix === "Port" && hasInvalidExportedPort(node)) {
          context.report({
            node,
            messageId: "abstract",
            data: { suffix: "Port" },
          });
          return;
        }
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
  return name.endsWith(".service.ts") ? name.slice(0, -".service.ts".length) : undefined;
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
    node.specifiers.some((specifier) => importedName(specifier)?.endsWith("Repository"))
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
      /(?:PrismaClient|ClickHouseClient|RedisClient)$/.test(importedName(item) ?? ""),
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
        const target = repositoryTarget(node.source.value, filename, context.cwd);
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
  "service-quality": serviceQualityRule,
  "max-statements-per-line": maxStatementsPerLineRule,
  "service-member-spacing": serviceMemberSpacingRule,
  "service-dependencies": serviceDependenciesRule,
  "runtime-undefined": runtimeUndefinedRule,
  "logical-statement-spacing": logicalStatementSpacingRule,
  "boolean-wall": booleanWallRule,
  "awaited-return-chain": awaitedReturnChainRule,
};

export default {
  meta: { name: "eslint-plugin-langwatch", version: "0.1.0" },
  rules,
};
