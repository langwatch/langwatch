import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  COMMENT_BLOCK_SIZE_MESSAGE,
  MAX_COMMENT_BLOCK_LINES,
  collectCommentBlocks,
  commentBlockSizeMessage,
  isExemptBlock,
  marksGeneratedHeader,
  marksLicenseHeader,
  mayContainReviewBlock,
  rootCovers,
} from "@langwatch/lint-core/grammar/comment-block-policy.mjs";
import {
  CONTRACT_ARTIFACT,
  CONTRACT_ARTIFACT_SUFFIX,
  PROCESS_MANAGER_SERVICE_PATTERN,
  PURE_VALUE_CONSTRUCTORS,
  RULES_PATTERN,
  SERVER_ONLY_CONTRACT_ARTIFACT,
  SERVER_PATTERNS,
  SUBJECT_ARTIFACT,
  TEST_DIRECTORY,
  claimedSubjects,
  claimsSubject,
  isLowerKebabFilename,
  isStrictServerFilename,
} from "@langwatch/lint-core/grammar/feature-layout-policy.mjs";
import { conditionShapeRule } from "@langwatch/lint-core";
import { isOverengineeringSource, overengineeringFindings } from "./src/overengineering-policy.mjs";

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
  const file = join(cwd, "packages", "architecture-lint", "src", "port-module-baseline.json");
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

const boundaryRule = {
  meta: {
    type: "problem",
    messages: {
      compositionRoot:
        "Feature server packages may be imported only by app or worker runtime composition roots.",
      crossFeature: "Cross-feature collaboration must use the owning feature's contract package.",
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
      sealedExports: "This package subpath is not declared in the target package's exports map.",
    },
  },
  create(context) {
    const filename = normalizedFilename(context);
    const classification = classifyFile(filename, context.cwd);
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
          if (escaped) context.report({ node, messageId: "packageEscape" });

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
          context.report({ node, messageId: "sealedExports" });
        }
        if (
          classification.feature &&
          target.pkg.feature !== classification.feature &&
          target.pkg.role !== "contract" &&
          !testSupportImport &&
          !webSurfaceImport
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
        context.report({ node, messageId: "schemaBoundary" });
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
        context.report({ node, messageId: "packageRole" });
      }
      if (productionSource && classification.role === "web" && (nodeRuntime || serverRuntime)) {
        context.report({ node, messageId: "packageRole" });
      }
      if (productionSource && classification.role === "server" && browserRuntime) {
        context.report({ node, messageId: "packageRole" });
      }
      if (
        productionSource &&
        classification.role !== "other" &&
        // `~/`, `@app/` and `@ee/` were the deleted platform application's own
        // aliases. Nothing resolves them any more, so an import naming one is a
        // reintroduction, not a legacy edge — and is reported as such.
        /^(~\/|@app\/|@ee\/)/.test(specifier)
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
        "Reusable packages receive typed configuration; they must not read environment variables directly. Parse environment configuration at a physical application composition root and inject semantic values.",
    },
  },
  create(context) {
    const filename = normalizedFilename(context);
    const classification = classifyFile(filename, context.cwd);
    const workspacePath = classification.workspacePath;
    const reusablePackage = /^packages\/.+\/src\//.test(workspacePath);
    const processApp = isEnvironmentGovernedApp(workspacePath);
    const productionSource = !isNonProductionPackageSource(workspacePath);
    if ((!reusablePackage && !processApp) || !productionSource) return {};
    // A package may never read the environment. An app may, but only where it
    // is composing the process — that is the "physical application composition
    // root" the message names, and it is the one place a typed value can be
    // parsed before anything downstream sees it.
    if (processApp && isApplicationCompositionRoot(workspacePath)) return {};

    return {
      MemberExpression(node) {
        const propertyName = staticMemberPropertyName(node);
        const isProcessEnv =
          node.object.type === "Identifier" &&
          node.object.name === "process" &&
          propertyName === "env";
        const isImportMetaEnv = node.object.type === "MetaProperty" && propertyName === "env";
        if (isProcessEnv || isImportMetaEnv) {
          context.report({ node, messageId: "environment" });
        }
      },
    };
  },
};

/**
 * The process apps whose features must receive configuration rather than read it.
 */
function isEnvironmentGovernedApp(workspacePath) {
  return /^apps\/(?:api|worker|ui)\/src\//.test(workspacePath);
}

/**
 * Where an app is allowed to read the environment: its config modules, and the
 * files that boot or compose the process. Everything else in an app — features,
 * services, repositories, adapters, routes — receives typed values.
 */
function isApplicationCompositionRoot(workspacePath) {
  const configModule = /(?:^|\/)platform\/config\//.test(workspacePath);
  const processBoot = /\.(?:composition|executable|entrypoint|main|runtime)\.[cm]?tsx?$/.test(
    workspacePath,
  );
  return configModule || processBoot;
}

function isNonProductionPackageSource(workspacePath) {
  const nonProductionDirectory = /(?:^|\/)(?:__tests__|tests|__bench__|benchmarks?)(?:\/|$)/.test(
    workspacePath,
  );
  const nonProductionFilename = /\.(?:test|unit|integration|spec|bench)\.[cm]?[jt]sx?$/.test(
    workspacePath,
  );
  return nonProductionDirectory || nonProductionFilename;
}

/**
 * This is a direct-syntax guard, not taint analysis: it catches canonical
 * process/import-meta environment spellings, including static computed keys,
 * but deliberately does not follow aliases or global-object indirection.
 */
function staticMemberPropertyName(member) {
  if (!member.computed && member.property.type === "Identifier") return member.property.name;
  return staticComputedPropertyName(member.property);
}

function staticComputedPropertyName(property) {
  if (property.type === "Literal" && typeof property.value === "string") {
    return property.value;
  }
  if (property.type === "TemplateLiteral" && property.expressions.length === 0) {
    return property.quasis[0]?.value.cooked ?? void 0;
  }
  if (property.type === "BinaryExpression" && property.operator === "+") {
    const left = staticComputedPropertyName(property.left);
    const right = staticComputedPropertyName(property.right);
    return left === undefined || right === undefined ? void 0 : `${left}${right}`;
  }
  return void 0;
}

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
  // A member declaration opens its own line, save for the modifiers in front of
  // it. Without this, a call inside a class-property arrow body (`this.rules
  // .list(...)`) reads as a second declaration of `list`, and a class with two
  // such properties reports a duplicate that is not there.
  const declaresOwnLine = (source, index) => {
    const lineStart = source.lastIndexOf("\n", index - 1) + 1;
    const prefix = source.slice(lineStart, index);
    return /^\s*(?:(?:public|private|protected|readonly|static|abstract|async|override|declare|get|set)\s+)*\*?\s*$/.test(
      prefix,
    );
  };
  const add = (name, index, source) => {
    if (depthAt(index) !== 0 || name === "constructor") return;
    if (!declaresOwnLine(source, index)) return;
    const entries = names.get(name) ?? [];
    entries.push(index);
    names.set(name, entries);
  };
  const normal = /\b([A-Za-z_$][\w$]*)\s*(?:<[^>{}]*>)?\s*\([^)]*\)\s*(?::[^{};]+)?\s*(?:\{|;)/g;
  for (const match of masked.matchAll(normal)) add(match[1], match.index, masked);
  const computed =
    /\[\s*(["'])([^"']+)\1\s*\]\s*(?:<[^>{}]*>)?\s*\([^)]*\)\s*(?::[^{};]+)?\s*(?:\{|;)/g;
  for (const match of classSource.matchAll(computed)) add(match[2], match.index, classSource);
  return names;
}

const serviceQualityRule = {
  meta: {
    type: "problem",
    messages: {
      duplicateMember: "A service class cannot declare the member {{name}} more than once.",
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
        for (const [name, occurrences] of sourceMethodNames(context.sourceCode.text, node)) {
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
            member.type === "MethodDefinition" && member.static && memberName(member) === "create",
        );
        if (!hasStaticCreate) return;
        const constructor = node.body.body.find(
          (member) => member.type === "MethodDefinition" && member.kind === "constructor",
        );
        if (constructor && (!constructor.accessibility || constructor.accessibility === "public")) {
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
      if (pattern.type === "ArrayPattern") return pattern.elements.some(hasUndefinedBinding);
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
        if (current.type === "CatchClause" && hasUndefinedBinding(current.param)) return true;
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
        if (node.name !== "undefined" || isNonValueIdentifier(node) || isShadowedUndefined(node)) {
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
  if (node.type !== "LogicalExpression" || (node.operator !== "&&" && node.operator !== "||")) {
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
    if (current.type === "MemberExpression" || current.type === "OptionalMemberExpression") {
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
      awaitedReturnChain: "Name the awaited result before chaining properties or calls from it.",
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
      statement.type === "ExportNamedDeclaration" || statement.type === "ExportDefaultDeclaration";
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
      concrete: "A strict feature runtime module must export a concrete {{suffix}} class.",
      create: "A concrete strict feature class must expose construction through static create.",
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
  const application = normalized.match(/^(apps\/(?:api|worker|ui)\/src\/[^/]+)\//);
  return application ? resolve(cwd, application[1]) : dirname(filename);
}

function repositoryTarget(specifier, filename, cwd) {
  if (specifier.startsWith(".")) return resolve(dirname(filename), specifier);
  // `~/` was the deleted platform application's alias root. It resolves to
  // nothing now; returning undefined is what makes an import that still uses it
  // unresolvable rather than silently pointed at a path that is not there.
  if (specifier.startsWith("~/")) return undefined;
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

/**
 * A door in a strict feature package: `src/transport/<surface>/<name>.api.ts`.
 * `src/api/<surface>/` is the name that directory used to have, and four packages still publish
 * a family from it, so both are matched.
 */
function isFeatureApi(classification) {
  return (
    classification.role === "server" &&
    /^src\/(?:transport|api)\/[^/]+\/.+\.api\.ts$/.test(classification.relative ?? "")
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
      contextCast: "API context is already typed; do not cast it to recover application services.",
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

// SonarSource cognitive complexity: a structural +1 per control-flow break,
// plus the current nesting level for the constructs that nest. `else` and
// `else if` take the +1 without the nesting penalty, boolean sequences and
// recursion take +1 flat, and a nested function raises the nesting level for
// everything inside it.
const COGNITIVE_FUNCTION_TYPES = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
]);

function isLogicalSequence(node) {
  return node.type === "LogicalExpression" && (node.operator === "&&" || node.operator === "||");
}

function isNestedFunction(node) {
  let current = node.parent;
  while (current) {
    if (COGNITIVE_FUNCTION_TYPES.has(current.type)) return true;
    current = current.parent;
  }
  return false;
}

function functionName(node) {
  if (node.id?.name) return node.id.name;
  const owner = node.parent;
  if (!owner) return undefined;
  if (owner.type === "VariableDeclarator" && owner.id?.type === "Identifier") return owner.id.name;
  if (
    (owner.type === "MethodDefinition" || owner.type === "PropertyDefinition") &&
    owner.key?.type === "Identifier"
  ) {
    return owner.key.name;
  }
  if (owner.type === "Property" && owner.key?.type === "Identifier") return owner.key.name;
  return undefined;
}

function isRecursiveCall(node, name) {
  if (!name) return false;
  const callee = node.callee;
  if (!callee) return false;
  if (callee.type === "Identifier") return callee.name === name;
  return (
    callee.type === "MemberExpression" &&
    !callee.computed &&
    callee.object?.type === "ThisExpression" &&
    callee.property?.type === "Identifier" &&
    callee.property.name === name
  );
}

function* childNodes(node) {
  for (const key of Object.keys(node)) {
    if (key === "parent") continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item.type === "string") yield item;
      }
      continue;
    }
    if (value && typeof value.type === "string") yield value;
  }
}

function cognitiveComplexity(functionNode) {
  let score = 0;

  const walkIf = (node, nesting, isElseIf, owner) => {
    score += isElseIf ? 1 : 1 + nesting;
    walk(node.test, nesting, owner);
    walk(node.consequent, nesting + 1, owner);
    const alternate = node.alternate;
    if (!alternate) return;
    if (alternate.type === "IfStatement") {
      walkIf(alternate, nesting, true, owner);
      return;
    }
    score += 1;
    walk(alternate, nesting + 1, owner);
  };

  const walkChildren = (node, nesting, owner) => {
    for (const child of childNodes(node)) walk(child, nesting, owner);
  };

  const walkNested = (node, nesting, owner, bodyNesting) => {
    for (const child of childNodes(node)) {
      walk(child, child === node.body ? bodyNesting : nesting, owner);
    }
  };

  function walk(node, nesting, owner) {
    if (!node) return;
    switch (node.type) {
      case "IfStatement":
        walkIf(node, nesting, false, owner);
        return;
      case "ConditionalExpression":
        score += 1 + nesting;
        walk(node.test, nesting, owner);
        walk(node.consequent, nesting + 1, owner);
        walk(node.alternate, nesting + 1, owner);
        return;
      case "SwitchStatement":
        score += 1 + nesting;
        walk(node.discriminant, nesting, owner);
        for (const switchCase of node.cases) walk(switchCase, nesting + 1, owner);
        return;
      case "ForStatement":
      case "ForInStatement":
      case "ForOfStatement":
      case "WhileStatement":
      case "DoWhileStatement":
        score += 1 + nesting;
        walkNested(node, nesting, owner, nesting + 1);
        return;
      case "CatchClause":
        score += 1 + nesting;
        walkNested(node, nesting, owner, nesting + 1);
        return;
      case "LogicalExpression": {
        if (!isLogicalSequence(node)) break;
        const operators = [];
        const leaves = [];
        const flatten = (current) => {
          if (!isLogicalSequence(current)) {
            leaves.push(current);
            return;
          }
          flatten(current.left);
          operators.push(current.operator);
          flatten(current.right);
        };
        flatten(node);
        let sequences = 1;
        for (let index = 1; index < operators.length; index += 1) {
          if (operators[index] !== operators[index - 1]) sequences += 1;
        }
        score += sequences;
        for (const leaf of leaves) walk(leaf, nesting, owner);
        return;
      }
      case "BreakStatement":
      case "ContinueStatement":
        if (node.label) score += 1;
        return;
      case "CallExpression":
        if (isRecursiveCall(node, owner)) score += 1;
        break;
      case "FunctionDeclaration":
      case "FunctionExpression":
      case "ArrowFunctionExpression":
        walkNested(node, nesting, functionName(node) ?? owner, nesting + 1);
        return;
      default:
        break;
    }
    walkChildren(node, nesting, owner);
  }

  walkNested(functionNode, 0, functionName(functionNode), 0);
  return score;
}

const cognitiveComplexityRule = {
  meta: {
    type: "problem",
    schema: [
      {
        type: "object",
        properties: { max: { type: "integer", minimum: 0 } },
        additionalProperties: false,
      },
    ],
    messages: {
      tooComplex:
        "Function has a cognitive complexity of {{complexity}}. Maximum allowed is {{max}}.",
    },
  },
  create(context) {
    const max = context.options?.[0]?.max ?? 15;

    const check = (node) => {
      if (isNestedFunction(node)) return;
      const complexity = cognitiveComplexity(node);
      if (complexity <= max) return;
      context.report({
        node,
        messageId: "tooComplex",
        data: { complexity: String(complexity), max: String(max) },
      });
    };

    return {
      FunctionDeclaration: check,
      FunctionExpression: check,
      ArrowFunctionExpression: check,
    };
  },
};

// ---------------------------------------------------------------------------
// Comment blocks (policy `comment-block-size`).
//
// A block of 6 to 8 lines warns, 9 or more errors, and a comment line wider
// than 100 columns errors. The CLI keeps the 4-5 line review queue and the
// `comment-block-roots.json` burn-down checks; the block grammar itself is
// the shared module both import.

const COMMENT_EXCLUDED_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".next-saas",
  "build",
  "coverage",
  "dist",
  "generated",
  "node_modules",
  "vendor",
]);

export const COMMENT_BLOCK_WARN_LINES = 6;
export const COMMENT_BLOCK_ERROR_LINES = 9;
export const MAX_COMMENT_COLUMNS = 100;

const changedFilesCache = new Map();
const commentBlockRootsCache = new Map();

function gitOutput(cwd, arguments_) {
  try {
    return execFileSync("git", ["-C", cwd, ...arguments_], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch {
    return undefined;
  }
}

function gitPaths(cwd, arguments_) {
  return (gitOutput(cwd, arguments_) ?? "").split("\0").filter((path) => path.length > 0);
}

function mergeBase(cwd) {
  for (const reference of ["@{upstream}", "origin/main", "main"]) {
    const base = gitOutput(cwd, ["merge-base", "HEAD", reference])?.trim();
    if (base) return base;
  }
  return gitOutput(cwd, ["rev-parse", "HEAD^"])?.trim();
}

/**
 * Files introduced since the branch base, modified locally, or untracked, as
 * workspace-relative paths. `undefined` outside a git checkout, where every
 * file counts as changed — the same fallback the CLI takes.
 */
function changedFiles(cwd) {
  if (changedFilesCache.has(cwd)) return changedFilesCache.get(cwd);
  let changed;
  if (gitOutput(cwd, ["rev-parse", "--is-inside-work-tree"])) {
    changed = new Set([
      ...gitPaths(cwd, ["diff", "--name-only", "-z", "--diff-filter=ACMR", "HEAD"]),
      ...gitPaths(cwd, ["ls-files", "--others", "--exclude-standard", "-z"]),
    ]);
    const base = mergeBase(cwd);
    if (base) {
      for (const path of gitPaths(cwd, [
        "diff",
        "--name-only",
        "-z",
        "--diff-filter=ACMR",
        `${base}...HEAD`,
      ])) {
        changed.add(path);
      }
    }
  }
  changedFilesCache.set(cwd, changed);
  return changed;
}

function commentBlockRoots(cwd) {
  if (commentBlockRootsCache.has(cwd)) return commentBlockRootsCache.get(cwd);
  const file = join(cwd, "packages", "architecture-lint", "src", "comment-block-roots.json");
  let entries = [];
  if (existsSync(file)) {
    try {
      const value = JSON.parse(readFileSync(file, "utf8"));
      if (value.version === 0 && Array.isArray(value.roots)) entries = value.roots;
    } catch {
      entries = [];
    }
  }
  commentBlockRootsCache.set(cwd, entries);
  return entries;
}

function workspacePathOf(context) {
  return relative(context.cwd, normalizedFilename(context)).split(sep).join("/");
}

function isCommentScannedPath(workspacePath) {
  if (workspacePath.startsWith("../")) return false;
  if (workspacePath.split("/").some((segment) => COMMENT_EXCLUDED_DIRECTORIES.has(segment))) {
    return false;
  }
  return !/\.(?:generated|gen)\.[cm]?[jt]sx?$/.test(workspacePath);
}

/**
 * Whether the burn-down allowlist still covers this file. A changed file is
 * never covered: new commentary is held to the limit wherever it lands.
 */
function isCoveredByAllowedRoot(context, workspacePath) {
  const changed = changedFiles(context.cwd);
  if (!changed || changed.has(workspacePath)) return false;
  const today = new Date().toISOString().slice(0, 10);
  return commentBlockRoots(context.cwd).some((entry) => rootCovers(entry, workspacePath, today));
}

function commentRangesOf(program) {
  return (program.comments ?? [])
    .filter((comment) => comment.type !== "Shebang")
    .map((comment) => ({ pos: comment.start, end: comment.end }))
    .sort((left, right) => left.pos - right.pos || left.end - right.end);
}

function commentBlocksOf(context, program) {
  const source = context.sourceCode.text;
  if (marksGeneratedHeader(source) || marksLicenseHeader(source)) return [];
  if (!mayContainReviewBlock(source)) return [];
  const blocks = collectCommentBlocks({ source, ranges: commentRangesOf(program) });
  const lines = source.split(/\r?\n/);
  return blocks.filter((block) => {
    const text = lines.slice(block.line - 1, block.line - 1 + block.lines).join("\n");
    return !isExemptBlock(text);
  });
}

function commentBlockRuleSetup(context) {
  const workspacePath = workspacePathOf(context);
  if (!isCommentScannedPath(workspacePath)) return undefined;
  if (isCoveredByAllowedRoot(context, workspacePath)) return undefined;
  return workspacePath;
}

const commentBlockSizeRule = {
  meta: {
    type: "problem",
    messages: {
      commentColumns: `Wrap this comment at ${MAX_COMMENT_COLUMNS} columns`,
    },
  },
  create(context) {
    if (!commentBlockRuleSetup(context)) return {};

    return {
      Program(program) {
        const source = context.sourceCode.text;
        for (const block of commentBlocksOf(context, program)) {
          if (block.lines < COMMENT_BLOCK_ERROR_LINES) continue;
          context.report({
            loc: { line: block.line, column: 0 },
            message: commentBlockSizeMessage(block.lines),
          });
        }
        if (marksGeneratedHeader(source) || marksLicenseHeader(source)) return;
        const lines = source.split(/\r?\n/);
        const reported = new Set();
        for (const range of commentRangesOf(program)) {
          const start = source.slice(0, range.pos).split(/\r?\n/).length;
          const end = source.slice(0, Math.max(range.pos, range.end - 1)).split(/\r?\n/).length;
          for (let line = start; line <= end; line += 1) {
            if (reported.has(line)) continue;
            if ((lines[line - 1]?.length ?? 0) <= MAX_COMMENT_COLUMNS) continue;
            reported.add(line);
            context.report({
              loc: { line, column: 0 },
              messageId: "commentColumns",
            });
          }
        }
      },
    };
  },
};

const commentBlockSizeWarningRule = {
  meta: { type: "suggestion", messages: { commentBlockSize: COMMENT_BLOCK_SIZE_MESSAGE } },
  create(context) {
    if (!commentBlockRuleSetup(context)) return {};

    return {
      Program(program) {
        for (const block of commentBlocksOf(context, program)) {
          if (block.lines < COMMENT_BLOCK_WARN_LINES) continue;
          if (block.lines >= COMMENT_BLOCK_ERROR_LINES) continue;
          context.report({
            loc: { line: block.line, column: 0 },
            messageId: "commentBlockSize",
            data: { lines: block.lines, max: MAX_COMMENT_BLOCK_LINES },
          });
        }
      },
    };
  },
};

// ---------------------------------------------------------------------------
// Result contracts (policy `fallible-result-naming`).

const FALLIBLE_RESULT_MODULE = /\.(?:service|port|repository|store)\.ts$/;

function promiseTypeArgument(node) {
  if (node.type !== "TSTypeReference") return undefined;
  if (node.typeName?.type !== "Identifier" || node.typeName.name !== "Promise") return undefined;
  const parameters = node.typeArguments?.params ?? [];
  return parameters.length === 1 ? parameters[0] : undefined;
}

function containsNullableType(node) {
  if (!node) return false;
  if (node.type === "TSUndefinedKeyword" || node.type === "TSNullKeyword") return true;
  if (node.type === "TSParenthesizedType") return containsNullableType(node.typeAnnotation);
  if (node.type === "TSUnionType") return node.types.some(containsNullableType);
  const promiseArgument = promiseTypeArgument(node);
  if (promiseArgument) return containsNullableType(promiseArgument);
  return false;
}

const NON_NULLABLE_TYPES = new Set([
  "TSStringKeyword",
  "TSNumberKeyword",
  "TSBooleanKeyword",
  "TSBigIntKeyword",
  "TSSymbolKeyword",
  "TSObjectKeyword",
  "TSVoidKeyword",
  "TSTypeLiteral",
  "TSArrayType",
  "TSTupleType",
  "TSFunctionType",
]);

function definitelyNonNullableType(node) {
  if (!node) return false;
  if (node.type === "TSParenthesizedType") return definitelyNonNullableType(node.typeAnnotation);
  if (node.type === "TSUnionType") return node.types.every(definitelyNonNullableType);
  const promiseArgument = promiseTypeArgument(node);
  if (promiseArgument) return definitelyNonNullableType(promiseArgument);
  if (node.type === "TSLiteralType") return node.literal?.type !== "NullLiteral";
  return NON_NULLABLE_TYPES.has(node.type);
}

function isFallibleResultModule(context) {
  const file = classifyFile(normalizedFilename(context), context.cwd);
  if (file.role !== "contract" && file.role !== "server") return false;
  if (file.layoutVersion !== 0) return false;
  if (!file.relative?.startsWith("src/")) return false;
  return FALLIBLE_RESULT_MODULE.test(file.relative);
}

const fallibleResultNamingRule = {
  meta: {
    type: "problem",
    messages: {
      requirePrefix: "Capability {{name}} uses the redundant require prefix.",
      noResultType:
        "Capability {{name}} has no explicit result type, so its absence contract cannot be enforced.",
      untriedAbsence: "Capability {{name}} exposes absence without the try prefix.",
      tryWithoutAbsence: "Optional capability {{name}} cannot express absence.",
    },
  },
  create(context) {
    if (!isFallibleResultModule(context)) return {};

    const check = (node) => {
      if (node.kind !== "method" || node.computed) return;
      if (node.key?.type !== "Identifier") return;
      if (node.accessibility === "private") return;
      const name = JSON.stringify(node.key.name);
      // `requireById` — the imperative — is the redundant one: an ordinary
      // method already returns a value or throws. `required` is an adjective
      // the boolean-name policy allows, so it is not this.
      if (/^require[A-Z]/.test(node.key.name)) {
        context.report({ node: node.key, messageId: "requirePrefix", data: { name } });
      }
      const returnType = node.value?.returnType?.typeAnnotation;
      if (!returnType) {
        context.report({ node: node.key, messageId: "noResultType", data: { name } });
        return;
      }
      const optional = node.key.name.startsWith("try");
      if (containsNullableType(returnType) && !optional) {
        context.report({ node: node.key, messageId: "untriedAbsence", data: { name } });
        return;
      }
      if (!containsNullableType(returnType) && optional && definitelyNonNullableType(returnType)) {
        context.report({ node: node.key, messageId: "tryWithoutAbsence", data: { name } });
      }
    };

    return {
      MethodDefinition: check,
      TSAbstractMethodDefinition: check,
    };
  },
};

// ---------------------------------------------------------------------------
// The per-file half of the strict feature layout grammar (policies
// `feature-source-filename`, `feature-source-layout`, `feature-source-subject`).
// What needs the whole package graph — a package's missing service module,
// a rules module's import closure, private runtime exports — stays in the CLI.

/** A strict feature source file, as `{ role, sourcePath, name }`. */
function strictFeatureSource(context) {
  const file = classifyFile(normalizedFilename(context), context.cwd);
  if (file.role !== "contract" && file.role !== "server" && file.role !== "web") return undefined;
  if (file.layoutVersion !== 0) return undefined;
  if (!file.relative?.startsWith("src/")) return undefined;
  const sourcePath = file.relative.slice("src/".length);
  if (TEST_DIRECTORY.test(sourcePath)) return undefined;
  return {
    feature: file.feature,
    enterprise: file.enterprise,
    role: file.role,
    sourcePath,
    name: sourcePath.slice(sourcePath.lastIndexOf("/") + 1),
  };
}

const featureSourceFilenameRule = {
  meta: {
    type: "problem",
    messages: {
      filename:
        "Strict feature source filename {{name}} is not lower-case kebab case with dotted architectural qualifiers.",
    },
  },
  create(context) {
    const source = strictFeatureSource(context);
    if (!source) return {};
    if (!/\.[cm]?[jt]sx?$/.test(source.name)) return {};
    const valid =
      source.role === "server"
        ? isStrictServerFilename(source.name)
        : isLowerKebabFilename(source.name);
    if (valid) return {};

    return {
      Program(node) {
        context.report({
          node,
          messageId: "filename",
          data: { name: JSON.stringify(source.name) },
        });
      },
    };
  },
};

const featureSourceLayoutRule = {
  meta: {
    type: "problem",
    messages: {
      contractMissingSubject: "Contract artifact {{name}} is missing its subject.",
      contractServerArtifact: "Server artifact {{name}} cannot live in contract source.",
      contractFilename: "Contract artifact filename {{name}} is not lower-case kebab case.",
      processManagerService: "Process manager source {{path}} cannot masquerade as a service.",
      rulesImpurity:
        "Rules module {{path}} may only export functions and constants (found {{found}}).",
      serverPath: "Server source path {{path}} is not part of strict layout version 0.",
    },
  },
  create(context) {
    const source = strictFeatureSource(context);
    if (!source) return {};
    const { name, sourcePath, role } = source;

    if (role === "contract") {
      if (name === "index.ts") return {};
      const report = (messageId) => ({
        Program(node) {
          context.report({ node, messageId, data: { name: JSON.stringify(name) } });
        },
      });
      if (/^(?:commands|errors|events|queries|service)\.ts$/.test(name)) {
        return report("contractMissingSubject");
      }
      if (SERVER_ONLY_CONTRACT_ARTIFACT.test(name)) return report("contractServerArtifact");
      if (
        CONTRACT_ARTIFACT_SUFFIX.test(name) &&
        !CONTRACT_ARTIFACT.test(name) &&
        isLowerKebabFilename(name)
      ) {
        return report("contractFilename");
      }
      return {};
    }

    if (role !== "server") return {};

    if (PROCESS_MANAGER_SERVICE_PATTERN.test(sourcePath)) {
      return {
        Program(node) {
          context.report({
            node,
            messageId: "processManagerService",
            data: { path: JSON.stringify(sourcePath) },
          });
        },
      };
    }

    if (RULES_PATTERN.test(sourcePath)) {
      let reported = false;
      const report = (node, found) => {
        if (reported) return;
        reported = true;
        context.report({
          node,
          messageId: "rulesImpurity",
          data: { path: JSON.stringify(sourcePath), found },
        });
      };
      return {
        ClassDeclaration(node) {
          report(node, "a class");
        },
        ClassExpression(node) {
          report(node, "a class");
        },
        NewExpression(node) {
          if (node.callee?.type === "Identifier" && PURE_VALUE_CONSTRUCTORS.has(node.callee.name)) {
            return;
          }
          report(node, "a `new` expression");
        },
      };
    }

    if (SERVER_PATTERNS.some((pattern) => pattern.test(sourcePath))) return {};

    return {
      Program(node) {
        context.report({
          node,
          messageId: "serverPath",
          data: { path: JSON.stringify(sourcePath) },
        });
      },
    };
  },
};

const subjectOwnerCache = new Map();

/**
 * Which feature owns each subject, for the features that have a physical
 * package. Dormant catalogue entries are migration intent, not a demand for
 * placeholder packages, so they own nothing yet.
 */
function subjectOwners(cwd) {
  if (subjectOwnerCache.has(cwd)) return subjectOwnerCache.get(cwd);
  const owners = new Map();
  const file = join(cwd, "packages", "features", "catalogue.json");
  const migrated = new Set();
  for (const pkg of loadWorkspace(cwd).packages.values()) migrated.add(pkg.feature);
  if (existsSync(file)) {
    try {
      const value = JSON.parse(readFileSync(file, "utf8"));
      for (const entry of value.features ?? []) {
        if (!migrated.has(entry.id)) continue;
        for (const subject of entry.subjects ?? []) owners.set(subject, entry.id);
      }
    } catch {
      owners.clear();
    }
  }
  subjectOwnerCache.set(cwd, owners);
  return owners;
}

const featureSourceSubjectRule = {
  meta: {
    type: "problem",
    messages: {
      foreignSubject:
        "Source module {{path}} claims {{subject}}, which belongs to the singular {{owner}} feature.",
    },
  },
  create(context) {
    const source = strictFeatureSource(context);
    if (!source || (source.role !== "contract" && source.role !== "server")) return {};
    if (source.sourcePath === "index.ts") return {};
    if (!SUBJECT_ARTIFACT.test(source.sourcePath)) return {};

    const owners = subjectOwners(context.cwd);
    const foreign = claimedSubjects(source.sourcePath).flatMap((candidate) =>
      [...owners].filter(
        ([subject, owner]) =>
          owner !== source.feature && claimsSubject(candidate, source.feature, subject),
      ),
    );
    if (foreign.length === 0) return {};
    const [subject, owner] = foreign[0];

    return {
      Program(node) {
        context.report({
          node,
          messageId: "foreignSubject",
          data: {
            path: JSON.stringify(source.sourcePath),
            subject: JSON.stringify(subject),
            owner: JSON.stringify(owner),
          },
        });
      },
    };
  },
};

// ---------------------------------------------------------------------------
// Prisma containment (policy `prisma-containment`) and the typed seam
// (policy `typed-prisma-seam`).

const PRISMA_ROOT = "@langwatch/prisma-client";
const PRISMA_GENERATED = "@langwatch/prisma-client/generated";
const APPLICATION_ROOTS = new Set(["ui", "api", "worker", "server"]);

/**
 * The package a file belongs to, for the boundary rules that ask what kind
 * of package they are standing in. Mirrors the CLI's classification for the
 * roots those rules police, and reports nothing anywhere else.
 */
function prismaPackageOf(filename, cwd) {
  const workspacePath = relative(cwd, filename).split(sep).join("/");
  const feature = workspacePath.match(
    /^packages\/(enterprise\/)?features\/([^/]+)\/(contract|server|web)\/src\/(.+)$/,
  );
  if (feature) {
    return { kind: feature[3], feature: feature[2], relative: feature[4], workspacePath };
  }
  const application = workspacePath.match(/^apps\/([^/]+)\/src\/(.+)$/);
  if (application && APPLICATION_ROOTS.has(application[1])) {
    return { kind: "application", relative: application[2], workspacePath };
  }
  const composition = workspacePath.match(
    /^packages\/enterprise\/composition\/(api|worker)\/src\/(.+)$/,
  );
  if (composition) {
    return { kind: "enterprise-composition", relative: composition[2], workspacePath };
  }
  const shared = workspacePath.match(/^packages\/(config|design-system)\/src\/(.+)$/);
  if (shared) return { kind: shared[1], relative: shared[2], workspacePath };
  return undefined;
}

function isPrismaProductionSource(relativePath) {
  if (/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(relativePath)) return false;
  const segments = relativePath.split("/");
  return !segments.includes("__tests__") && !segments.includes("__mocks__");
}

function isCompositionPrismaSeam(relativePath) {
  if (/\.composition\.ts$/.test(relativePath)) return true;
  if (/\.mount\.ts$/.test(relativePath)) return true;
  if (/\.adapter\.ts$/.test(relativePath)) return true;
  return relativePath.startsWith("platform/infrastructure/");
}

function isStrictPrismaAdapter(pkg) {
  if (pkg.kind === "application" || pkg.kind === "enterprise-composition") {
    return isCompositionPrismaSeam(pkg.relative);
  }
  if (pkg.kind !== "server") return false;
  if (pkg.relative.startsWith("repositories/prisma/")) return true;
  return /^adapters\/postgres\.[^/]+\.adapter\.ts$/.test(pkg.relative);
}

function importedSpecifier(node) {
  if (node.type === "ImportExpression") {
    return node.source?.type === "Literal" ? node.source.value : undefined;
  }
  return typeof node.source?.value === "string" ? node.source.value : undefined;
}

const prismaContainmentRule = {
  meta: {
    type: "problem",
    messages: {
      generatedPrisma:
        "Generated Prisma may only be imported by a repository under server/src/repositories/prisma or the Postgres composition adapter (server/src/adapters/postgres.<subject>.adapter.ts).",
      featurePrismaClient: "Feature packages cannot own Prisma connection or lifecycle services.",
    },
  },
  create(context) {
    const pkg = prismaPackageOf(normalizedFilename(context), context.cwd);
    if (!pkg || !isPrismaProductionSource(pkg.relative)) return {};
    const adapter = isStrictPrismaAdapter(pkg);

    const check = (node) => {
      const specifier = importedSpecifier(node);
      if (typeof specifier !== "string") return;
      const generated =
        specifier === PRISMA_GENERATED || specifier.startsWith(`${PRISMA_GENERATED}/`);
      if (generated && !adapter) {
        context.report({ node, messageId: "generatedPrisma" });
      }
      if (pkg.feature && specifier === PRISMA_ROOT) {
        context.report({ node, messageId: "featurePrismaClient" });
      }
    };

    return {
      ImportDeclaration: check,
      ImportExpression: check,
      ExportAllDeclaration: check,
      ExportNamedDeclaration: check,
    };
  },
};

const AS_PRISMA_CLIENT = /\bas\s+PrismaClient\b/;
// `database: object` when it sits directly in a `create(` argument list.
// Narrow on purpose: `object` is a load-bearing type in TypeScript, and only
// its use as the seam for a Prisma client is forbidden.
const DATABASE_OBJECT_ARG =
  /\.create\s*\([^)]*\bdatabase\s*:\s*object\b|\bstatic\s+create\s*\([^)]*\bdatabase\s*:\s*object\b/;

const typedPrismaSeamBaselineCache = new Map();

function typedPrismaSeamBaseline(cwd) {
  if (typedPrismaSeamBaselineCache.has(cwd)) return typedPrismaSeamBaselineCache.get(cwd);
  const file = join(cwd, "packages", "architecture-lint", "src", "typed-prisma-seam-baseline.json");
  let files = new Set();
  if (existsSync(file)) {
    try {
      const value = JSON.parse(readFileSync(file, "utf8"));
      if (value.version === 0 && Array.isArray(value.files)) files = new Set(value.files);
    } catch {
      files = new Set();
    }
  }
  typedPrismaSeamBaselineCache.set(cwd, files);
  return files;
}

const typedPrismaSeamRule = {
  meta: {
    type: "problem",
    messages: {
      cast: "`as PrismaClient` is not permitted: the composition adapter takes a typed PrismaClient and hands it to the repository.",
      databaseObject:
        "`database: object` in a `.create(` argument list forces a cast at the seam: type the parameter as PrismaClient and take it from the composition root.",
    },
  },
  create(context) {
    const filename = normalizedFilename(context);
    const workspacePath = relative(context.cwd, filename).split(sep).join("/");
    const seam =
      /^packages\/(?:enterprise\/)?features\/[^/]+\/server\/src\/repositories\/prisma\/.+\.repository\.ts$/.test(
        workspacePath,
      ) ||
      /^packages\/(?:enterprise\/)?features\/[^/]+\/server\/src\/adapters\/postgres\.[^/]+\.adapter\.ts$/.test(
        workspacePath,
      );
    if (!seam) return {};
    if (typedPrismaSeamBaseline(context.cwd).has(workspacePath)) return {};

    return {
      Program() {
        const source = context.sourceCode.text;
        for (const [pattern, messageId] of [
          [AS_PRISMA_CLIENT, "cast"],
          [DATABASE_OBJECT_ARG, "databaseObject"],
        ]) {
          const match = pattern.exec(source);
          if (!match) continue;
          context.report({
            loc: { line: source.slice(0, match.index).split(/\r?\n/).length, column: 0 },
            messageId,
          });
        }
      },
    };
  },
};

// ---------------------------------------------------------------------------
// The raw Hono app behind a SecuredApp. Registering a verb on it mounts a route
// the access policy never saw: the type system seals the published view and the
// boot assertion catches a mount that got past it, and this catches the source.

const RAW_HONO_MOUNT = /\.hono\.(?:get|post|put|patch|delete|all|on|use)\s*\(/g;

const noRawHonoMountRule = {
  meta: {
    type: "problem",
    messages: {
      rawMount: "Mount through `app.access(policy)`; the raw Hono app skips the access policy.",
    },
  },
  create(context) {
    const filename = normalizedFilename(context);
    const workspacePath = relative(context.cwd, filename).split(sep).join("/");
    if (!/^(?:apps|packages)\//.test(workspacePath)) return {};

    return {
      Program() {
        const source = context.sourceCode.text;
        RAW_HONO_MOUNT.lastIndex = 0;
        let match = RAW_HONO_MOUNT.exec(source);
        while (match) {
          context.report({
            loc: { line: source.slice(0, match.index).split(/\r?\n/).length, column: 0 },
            messageId: "rawMount",
          });
          match = RAW_HONO_MOUNT.exec(source);
        }
      },
    };
  },
};

// ---------------------------------------------------------------------------
// Over-abstraction (policies `layer-class`, `overload-by-literal`,
// `conditional-type-depth`). The detectors are the shared module the CLI's
// baseline check also imports; here they gate on the same baseline file.

const overengineeringBaselineCache = new Map();

function overengineeringBaseline(cwd) {
  if (overengineeringBaselineCache.has(cwd)) return overengineeringBaselineCache.get(cwd);
  const file = join(cwd, "packages", "architecture-lint", "src", "overengineering-baseline.json");
  let sites = new Set();
  if (existsSync(file)) {
    try {
      const value = JSON.parse(readFileSync(file, "utf8"));
      if (Array.isArray(value.sites)) sites = new Set(value.sites);
    } catch {
      sites = new Set();
    }
  }
  overengineeringBaselineCache.set(cwd, sites);
  return sites;
}

const overengineeringFindingCache = new Map();

function overengineeringFor(context, policy) {
  const filename = normalizedFilename(context);
  const workspacePath = relative(context.cwd, filename).split(sep).join("/");
  if (workspacePath.startsWith("../")) return [];
  if (!isOverengineeringSource(workspacePath)) return [];
  const source = context.sourceCode.text;
  const key = `${filename}|${source.length}|${policy}`;
  const cached = overengineeringFindingCache.get(key);
  const findings =
    cached ??
    overengineeringFindings({ path: filename, source }).filter((f) => f.policy === policy);
  overengineeringFindingCache.set(key, findings);
  if (overengineeringBaseline(context.cwd).has(`${policy}|${workspacePath}`)) return [];
  return findings;
}

function overengineeringRule(policy) {
  return {
    meta: { type: "problem", messages: {} },
    create(context) {
      return {
        Program() {
          for (const finding of overengineeringFor(context, policy)) {
            context.report({
              loc: { line: finding.line, column: 0 },
              message: finding.message,
            });
          }
        },
      };
    },
  };
}

const layerClassRule = overengineeringRule("layer-class");
const overloadByLiteralRule = overengineeringRule("overload-by-literal");
const conditionalTypeDepthRule = overengineeringRule("conditional-type-depth");

export const rules = {
  "api-context-services": apiContextServicesRule,
  "comment-block-size": commentBlockSizeRule,
  "comment-block-size-warning": commentBlockSizeWarningRule,
  "conditional-type-depth": conditionalTypeDepthRule,
  "fallible-result-naming": fallibleResultNamingRule,
  "feature-source-filename": featureSourceFilenameRule,
  "feature-source-layout": featureSourceLayoutRule,
  "feature-source-subject": featureSourceSubjectRule,
  "layer-class": layerClassRule,
  "no-raw-hono-mount": noRawHonoMountRule,
  "overload-by-literal": overloadByLiteralRule,
  "prisma-containment": prismaContainmentRule,
  "typed-prisma-seam": typedPrismaSeamRule,
  "cognitive-complexity": cognitiveComplexityRule,
  "condition-shape": conditionShapeRule,
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
