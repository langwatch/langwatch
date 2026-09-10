import { existsSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve, sep } from "node:path";
import { parseProgram } from "../parse.mjs";

const modules = new Map();
const factories = new Set(["object", "strictObject", "looseObject"]);
const objectMethods = new Set([
  "extend",
  "safeExtend",
  "merge",
  "pick",
  "omit",
  "partial",
  "required",
  "strict",
  "strip",
  "passthrough",
  "catchall",
  "describe",
  "meta",
  "brand",
  "clone",
]);
const refinements = new Set(["refine", "superRefine", "check"]);

export function memberName(node) {
  if (node?.type !== "MemberExpression") return void 0;
  if (!node.computed && node.property.type === "Identifier") return node.property.name;
  if (node.computed && node.property.type === "Literal") return node.property.value;
  return void 0;
}

export function unwrap(node) {
  while (
    ["TSAsExpression", "TSSatisfiesExpression", "TSNonNullExpression", "ChainExpression"].includes(
      node?.type,
    )
  ) {
    node = node.expression;
  }
  return node;
}

function importName(specifier) {
  if (specifier.type === "ImportNamespaceSpecifier") {
    return "*";
  }

  return specifier.imported?.name ?? specifier.imported?.value ?? "default";
}

function indexImports(statement, bindings) {
  if (statement.type !== "ImportDeclaration" || statement.importKind === "type") {
    return;
  }

  for (const item of statement.specifiers) {
    if (item.importKind !== "type") {
      bindings.set(item.local.name, { source: statement.source.value, name: importName(item) });
    }
  }
}

function indexVariables(statement, indexed) {
  const declaration = statement.declaration ?? statement;
  if (declaration.type !== "VariableDeclaration" || declaration.kind !== "const") {
    return;
  }

  for (const item of declaration.declarations) {
    if (item.id.type !== "Identifier") {
      continue;
    }

    indexed.bindings.set(item.id.name, { expression: item.init });
    if (statement.type === "ExportNamedDeclaration") {
      indexed.exports.set(item.id.name, { local: item.id.name });
    }
  }
}

function indexExports(statement, indexed) {
  if (statement.exportKind === "type") {
    return;
  }

  if (statement.type === "ExportDefaultDeclaration") {
    indexed.exports.set("default", { expression: statement.declaration });
    return;
  }

  if (statement.type === "ExportAllDeclaration") {
    indexed.stars.push(statement.source.value);
    return;
  }

  if (statement.type !== "ExportNamedDeclaration") {
    return;
  }

  for (const item of statement.specifiers) {
    if (item.exportKind === "type") {
      continue;
    }

    const name = item.local?.name ?? item.local?.value;
    const target = statement.source ? { source: statement.source.value, name } : { local: name };
    indexed.exports.set(item.exported.name ?? item.exported.value, target);
  }
}

function indexModule(filename) {
  const stat = statSync(filename);
  const cached = modules.get(filename);
  if (cached?.mtime === stat.mtimeMs && cached.size === stat.size) {
    return cached;
  }

  const program = parseProgram({ path: filename, text: readFileSync(filename, "utf8") });
  const indexed = {
    bindings: new Map(),
    exports: new Map(),
    stars: [],
    mtime: stat.mtimeMs,
    size: stat.size,
  };
  for (const statement of program.body) {
    indexImports(statement, indexed.bindings);
    indexVariables(statement, indexed);
    indexExports(statement, indexed);
  }

  modules.set(filename, indexed);
  return indexed;
}

// Resolve only workspace source. External libraries with similarly named
// methods are not Zod, and reading their dependency graphs would make linting expensive.
function sourceFile(source, filename, root) {
  let target;
  try {
    target = source.startsWith(".")
      ? resolve(dirname(filename), source)
      : createRequire(filename).resolve(source);
  } catch {
    return void 0;
  }
  const outsideWorkspace =
    !target.startsWith(root + sep) || target.includes(`${sep}node_modules${sep}`);
  if (outsideWorkspace) {
    return void 0;
  }
  const stem = target.replace(/\.[cm]?js$/, "");
  const candidates = [target, `${stem}.ts`, `${stem}.tsx`, resolve(target, "index.ts")];
  return candidates.find(
    (candidate) =>
      /\.[cm]?[jt]sx?$/.test(candidate) && existsSync(candidate) && statSync(candidate).isFile(),
  );
}

function memberOrigin(node, binding, seen) {
  const receiver = expressionOrigin(node.object, binding, seen);
  const method = memberName(node);
  if (typeof receiver === "function") {
    return receiver(method, seen);
  }

  const objectFactory = receiver === "zod" && factories.has(method);
  return objectFactory ? "factory" : void 0;
}

function callOrigin(node, binding, seen) {
  if (node.callee.type !== "MemberExpression") {
    return expressionOrigin(node.callee, binding, seen) === "factory" ? "object" : void 0;
  }

  const receiver = expressionOrigin(node.callee.object, binding, seen);
  const method = memberName(node.callee);
  const objectFactory = receiver === "zod" && factories.has(method);
  if (objectFactory) {
    return "object";
  }

  if (typeof receiver === "function") {
    return receiver(method, seen) === "factory" ? "object" : void 0;
  }

  if (receiver !== "object" && receiver !== "refined") {
    return void 0;
  }

  if (refinements.has(method)) {
    return "refined";
  }

  return objectMethods.has(method) ? receiver : void 0;
}

function expressionOrigin(expression, binding, seen) {
  const node = unwrap(expression);
  switch (node?.type) {
    case "Identifier":
      return binding(node, seen);
    case "MemberExpression":
      return memberOrigin(node, binding, seen);
    case "CallExpression":
      return callOrigin(node, binding, seen);
    default:
      return void 0;
  }
}

class ZodSchemaResolver {
  constructor(context, filename) {
    this.context = context;
    this.filename = filename;
    this.root = resolve(context.cwd);
  }

  imported(source, name, from, seen) {
    if (source === "zod") {
      if (["z", "default", "*"].includes(name)) {
        return "zod";
      }

      return factories.has(name) ? "factory" : void 0;
    }

    if (name === "*") {
      return (member, next) => this.imported(source, member, from, next);
    }

    const target = sourceFile(source, from, this.root);
    if (!target) {
      return void 0;
    }

    const key = `${target}:${name}`;
    if (seen.has(key)) {
      return void 0;
    }

    let module;
    try {
      module = indexModule(target);
    } catch {
      return void 0;
    }

    return this.exported(name, module, target, new Set(seen).add(key));
  }

  exported(name, module, target, seen) {
    const exported = module.exports.get(name);
    if (exported) {
      return this.descriptor(exported, module, target, seen);
    }

    for (const source of module.stars) {
      const origin = this.imported(source, name, target, seen);
      if (origin) {
        return origin;
      }
    }

    return void 0;
  }

  descriptor(item, module, from, seen) {
    if (!item) {
      return void 0;
    }

    if (item.source) {
      return this.imported(item.source, item.name, from, seen);
    }

    if (item.local) {
      return this.local(item.local, module, from, seen);
    }

    return expressionOrigin(
      item.expression,
      (node, next) => this.local(node.name, module, from, next),
      seen,
    );
  }

  local(name, module, from, seen) {
    const key = `${from}:local:${name}`;
    if (seen.has(key)) {
      return void 0;
    }

    return this.descriptor(module.bindings.get(name), module, from, new Set(seen).add(key));
  }

  binding(node, seen) {
    let scope = this.context.sourceCode.getScope(node);
    while (scope && !scope.set.has(node.name)) {
      scope = scope.upper;
    }

    const variable = scope?.set.get(node.name);
    const unknown = !variable || seen.has(variable);
    if (unknown) {
      return void 0;
    }

    const next = new Set(seen).add(variable);
    const definition = variable.defs[0];
    if (definition?.type === "ImportBinding") {
      const declaration = definition.parent;
      if (declaration.importKind === "type" || definition.node.importKind === "type") {
        return void 0;
      }

      return this.imported(
        declaration.source.value,
        importName(definition.node),
        this.filename,
        next,
      );
    }

    if (definition?.type !== "Variable" || definition.parent.kind !== "const") {
      return void 0;
    }

    return this.origin(definition.node.init, next);
  }

  origin(node, seen) {
    return expressionOrigin(node, (binding, next) => this.binding(binding, next), seen);
  }
}

export function createZodSchemaResolver(context, filename) {
  const resolver = new ZodSchemaResolver(context, filename);
  return (node) => resolver.origin(node, new Set());
}
