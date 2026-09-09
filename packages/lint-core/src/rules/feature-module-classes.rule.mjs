import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { defineRule } from "../define-rule.mjs";

// The per-file half of the strict feature module grammar: a port module
// exports an abstract `*Port` class, a runtime module exports a concrete one
// with a static `create`, and neither keeps behaviour in a standalone export.

const strictPortBaselineCache = new Map();

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

function declaredClasses(program) {
  const classes = [];
  const interfaces = [];
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
    if (exported && declaration.type === "TSInterfaceDeclaration") {
      interfaces.push(declaration);
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
  return { classes, interfaces, functions };
}

function isStaticCreateFactory(member) {
  if (member.type !== "PropertyDefinition") return false;
  if (!member.static) return false;
  if (member.key.type !== "Identifier" || member.key.name !== "create") return false;
  if (member.value?.type !== "CallExpression") return false;

  const factory = member.value.callee;
  if (factory.type !== "MemberExpression") return false;
  if (factory.object.type !== "ThisExpression") return false;
  return factory.property.type === "Identifier" && factory.property.name === "factory";
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
  if (/^(?:enterprise\/)?modules\/[^/]+\/contract\/src\/[^/]+\.app\.ts$/.test(normalized)) {
    return { suffix: "App", abstract: true, concrete: false };
  }
  const contract = normalized.match(
    /^(?:enterprise\/)?modules\/[^/]+\/contract\/src\/.+\.service\.ts$/,
  );
  if (contract) return { suffix: "Service", abstract: true, concrete: false };

  const server = normalized.match(/^(?:enterprise\/)?modules\/[^/]+\/server\/src\/(.+)$/);
  if (!server) return undefined;
  const path = server[1];
  if (/^app\/[^/]+\.app\.ts$/.test(path)) {
    return { suffix: "App", abstract: false, concrete: true };
  }
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

export const featureModuleClassesRule = defineRule({
  name: "feature-module-classes",
  kind: "problem",
  messages: {
    abstract: {
      what: "A strict feature port module must export an abstract {{suffix}} class.",
      fix: "Export an abstract `*{{suffix}}` class.",
    },
    concrete: {
      what: "A strict feature runtime module must export a concrete {{suffix}} class.",
      fix: "Export a concrete `*{{suffix}}` class.",
    },
    create: {
      what: "A concrete strict feature class must expose construction through static create.",
      fix: "Add a static `create` method.",
    },
    standalone: {
      what: "Exported function in `{{path}}`: a `{{suffix}}` module keeps behaviour on its class.",
      fix: "Move it onto the class or into `rules/`.",
    },
  },
  create(context, file) {
    if (file.layoutVersion !== 0) return {};
    const normalized = file.workspacePath;
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
          context.report({
            node: fn,
            messageId: "standalone",
            data: { path: normalized, suffix: kind.suffix },
          });
        }
        const matchingClasses = declarations.classes.filter((candidate) =>
          candidate.id?.name.endsWith(kind.suffix),
        );
        const matchingInterfaces = declarations.interfaces.filter((candidate) =>
          candidate.id?.name.endsWith(kind.suffix),
        );
        const valid = kind.abstract
          ? matchingClasses.filter((candidate) => candidate.abstract).concat(matchingInterfaces)
          : matchingClasses.filter((candidate) => !candidate.abstract);
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
              (member.type === "MethodDefinition" &&
                member.static &&
                member.key.type === "Identifier" &&
                member.key.name === "create") ||
              isStaticCreateFactory(member),
          );
          if (!hasStaticCreate) {
            context.report({ node: candidate, messageId: "create" });
          }
        }
      },
    };
  },
});
