import { defineRule } from "../define-rule.mjs";

// The class shape each module artifact exports, per ARCHITECTURE.md §3.2: a
// concrete class is built through `static create` behind a private constructor,
// an interface file declares an interface, and no artifact exports behaviour
// as a standalone function.

const METHOD_CREATE = "a `static create(...)` method returning `new {{name}}(...)`";
const FACTORY_CREATE =
  "a `static create(...)` method, or `static readonly create = this.factory(...)` inherited from `PrismaRepository.for(...)`";

const CONTRACT_KINDS = [
  { pattern: /^src\/[^/]+\.app\.ts$/, suffix: "App", shape: "declared" },
  { pattern: /^src\/.+\.service\.ts$/, suffix: "Service", shape: "declared" },
];

const PROCESS_KINDS = [
  {
    pattern: /^src\/services\/.+\.service\.ts$/,
    suffix: "Service",
    shape: "concrete",
    create: METHOD_CREATE,
    privateConstructor: true,
  },
  {
    pattern: /^src\/app\/[^/]+\.app\.ts$/,
    suffix: "App",
    shape: "concrete",
    create: METHOD_CREATE,
  },
  {
    pattern: /^src\/migrations\/.+\.migration\.ts$/,
    suffix: "Migration",
    shape: "concrete",
    create: METHOD_CREATE,
  },
  {
    pattern: /^src\/repositories\/[^/]+\.repository\.ts$/,
    suffix: "Repository",
    shape: "declared",
  },
  {
    pattern: /^src\/repositories\/[^/]+\/.+\.repository\.ts$/,
    suffix: "Repository",
    shape: "concrete",
    create: FACTORY_CREATE,
    inheritedFactory: true,
  },
];

function moduleClassKind(file) {
  if (!file.relative) return undefined;
  if (file.role === "contract")
    return CONTRACT_KINDS.find((kind) => kind.pattern.test(file.relative));
  if (file.role === "process")
    return PROCESS_KINDS.find((kind) => kind.pattern.test(file.relative));
  return undefined;
}

function isFunctionInit(item) {
  return item.init?.type === "ArrowFunctionExpression" || item.init?.type === "FunctionExpression";
}

function exportedDeclarations(program) {
  const found = { classes: [], functions: [], interfaces: [] };
  for (const statement of program.body) {
    const isExport =
      statement.type === "ExportNamedDeclaration" || statement.type === "ExportDefaultDeclaration";
    const declaration = isExport ? statement.declaration : undefined;
    if (!declaration) continue;
    if (declaration.type === "ClassDeclaration") found.classes.push(declaration);
    if (declaration.type === "TSInterfaceDeclaration") found.interfaces.push(declaration);
    if (declaration.type === "FunctionDeclaration") found.functions.push(declaration);
    if (declaration.type === "VariableDeclaration") {
      found.functions.push(...declaration.declarations.filter(isFunctionInit));
    }
  }
  return found;
}

function isStaticNamed(member, name) {
  return member.static && member.key?.type === "Identifier" && member.key.name === name;
}

// `static readonly create = this.factory(...)`: the create a `PrismaRepository.for(...)`
// backend inherits (ARCHITECTURE.md §3.2, "through `PrismaRepository.for`").
function isInheritedFactory(member) {
  if (member.type !== "PropertyDefinition" || !isStaticNamed(member, "create")) return false;
  const callee = member.value?.type === "CallExpression" ? member.value.callee : undefined;
  return (
    callee?.type === "MemberExpression" &&
    callee.object.type === "ThisExpression" &&
    callee.property.type === "Identifier" &&
    callee.property.name === "factory"
  );
}

function hasCreate(candidate, kind) {
  return candidate.body.body.some(
    (member) =>
      (member.type === "MethodDefinition" && isStaticNamed(member, "create")) ||
      (kind.inheritedFactory && isInheritedFactory(member)),
  );
}

function constructorOf(candidate) {
  return candidate.body.body.find(
    (member) => member.type === "MethodDefinition" && member.kind === "constructor",
  );
}

function validClasses(exported, kind) {
  const named = (candidate) => candidate.id?.name?.endsWith(kind.suffix);
  const matching = exported.classes.filter(named);
  if (kind.shape === "concrete") return matching.filter((candidate) => !candidate.abstract);
  return matching
    .filter((candidate) => candidate.abstract)
    .concat(exported.interfaces.filter(named));
}

function reportStandalone(context, { file, functions, kind, owner }) {
  for (const fn of functions) {
    context.report({
      node: fn,
      messageId: "standalone",
      data: {
        destination: owner?.id ? `of \`${owner.id.name}\`` : "of this module's class",
        name: fn.id?.name ?? "default",
        path: file.workspacePath,
        suffix: kind.suffix,
      },
    });
  }
}

function reportConstruction(context, { candidate, kind }) {
  const name = candidate.id?.name ?? "This class";
  if (!hasCreate(candidate, kind)) {
    const create = kind.create.replaceAll("{{name}}", name);
    context.report({ node: candidate, messageId: "create", data: { create, name } });
    return;
  }
  if (!kind.privateConstructor) return;
  const constructor = constructorOf(candidate);
  if (constructor?.accessibility === "private") return;
  context.report({
    node: constructor ?? candidate,
    messageId: "publicConstructor",
    data: { name },
  });
}

export const moduleClassesRule = defineRule({
  name: "module-classes",
  kind: "problem",
  applies: moduleClassKind,
  messages: {
    missingDeclared: {
      what: "`{{path}}` declares a {{suffix}} and exports no interface or abstract class named `*{{suffix}}`.",
      fix: "Export `interface <Name>{{suffix}}` here; the concrete class that implements it lives in its own file.",
    },
    missingConcrete: {
      what: "`{{path}}` exports no concrete class named `*{{suffix}}`.",
      fix: "Export one `class <Name>{{suffix}}` here; an interface for it belongs in the interface file beside it.",
    },
    create: {
      what: "`{{name}}` has no static create, so nothing builds it the one way a process installs it.",
      fix: "Add {{create}}.",
    },
    publicConstructor: {
      what: "`{{name}}` has `static create`, but its constructor is public, so a caller can bypass create with `new {{name}}(...)`.",
      fix: "Declare the constructor `private` — write `private constructor() {}` when the class has none.",
    },
    standalone: {
      what: "`{{name}}` is a function exported from the {{suffix}} module `{{path}}`; behaviour lives on the module's class.",
      fix:
        "If it is a pure function of its arguments, move it to the module's `rules/` folder," +
        " or drop `export` and keep it a private helper here. Otherwise make it a method {{destination}}.",
    },
  },
  create(context, file) {
    const kind = moduleClassKind(file);

    return {
      Program(node) {
        const exported = exportedDeclarations(node);
        const valid = validClasses(exported, kind);
        reportStandalone(context, { file, functions: exported.functions, kind, owner: valid[0] });
        if (valid.length === 0) {
          context.report({
            node,
            messageId: kind.shape === "declared" ? "missingDeclared" : "missingConcrete",
            data: { path: file.workspacePath, suffix: kind.suffix },
          });
          return;
        }
        if (kind.shape === "declared") return;
        for (const candidate of valid) reportConstruction(context, { candidate, kind });
      },
    };
  },
});
