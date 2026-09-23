import { defineRule } from "../define-rule.mjs";

// A boundary type written as `Parameters<typeof x>` follows whatever `x` is
// today; the contract stops saying what the boundary accepts. The double cast
// half of this check lives in `stand-in-cast`, which covers every source file.

const MIRROR_TYPES = new Set(["Parameters", "ReturnType", "ConstructorParameters"]);
const IGNORED_SEGMENTS = new Set([
  "__fixtures__",
  "__generated__",
  "__mocks__",
  "__tests__",
  "fixtures",
  "generated",
  "node_modules",
  "tests",
]);
const TYPESCRIPT = /\.tsx?$/;
const TEST_FILE = /\.(?:test|spec)\.[cm]?tsx?$/;
const COMPOSITION_ROOT = /^apps\/(?:api|worker|tasks|server)\/src\/.*\.composition\.ts$/;
const SCOPE_BODIES = new Set(["Program", "TSModuleBlock", "BlockStatement"]);
const TYPE_DECLARATIONS = new Set([
  "ClassDeclaration",
  "TSEnumDeclaration",
  "TSInterfaceDeclaration",
  "TSTypeAliasDeclaration",
]);

function isBoundarySource(file) {
  const path = file.workspacePath;
  if (!TYPESCRIPT.test(path) || path.endsWith(".d.ts")) return false;
  if (TEST_FILE.test(path)) return false;
  const segments = path.split("/");
  if (segments.some((segment) => IGNORED_SEGMENTS.has(segment))) return false;
  if (file.role === "contract") return file.relative?.startsWith("src/") ?? false;
  if (file.role === "process") return file.sourcePath?.startsWith("app/") ?? false;

  return COMPOSITION_ROOT.test(path);
}

function importedNames(statement) {
  return statement.specifiers
    .filter((specifier) => specifier.type !== "ImportNamespaceSpecifier")
    .map((specifier) => specifier.local.name);
}

/** The type names one statement binds in the scope it sits in. */
function boundTypeNames(statement) {
  if (statement.type === "ImportDeclaration") return importedNames(statement);
  const declaration = statement.declaration ?? statement;
  const named = TYPE_DECLARATIONS.has(declaration.type) && declaration.id;

  return named ? [declaration.id.name] : [];
}

function declaresTypeParameter(node, name) {
  return (node.typeParameters?.params ?? []).some((parameter) => parameter.name?.name === name);
}

function declaresInBody(node, name) {
  if (!SCOPE_BODIES.has(node.type)) return false;

  return node.body.some((statement) => boundTypeNames(statement).includes(name));
}

/** A local `Parameters`, type parameter or import of that name is not the global utility. */
function isShadowed(reference, name) {
  for (let node = reference.parent; node; node = node.parent) {
    if (declaresTypeParameter(node, name) || declaresInBody(node, name)) return true;
  }

  return false;
}

export const signatureMirrorRule = defineRule({
  name: "signature-mirror",
  kind: "problem",
  applies: isBoundarySource,
  messages: {
    mirroredSignature: {
      what: "This boundary type mirrors another signature through `{{name}}<…>`.",
      why: "A mirrored type changes whenever the mirrored function does, so the contract no longer states what the boundary accepts or returns.",
      fix: "Declare the input and output as named contract types (Zod schema plus `z.infer`) and type the `*Api` operation with them explicitly.",
    },
  },
  create(context) {
    return {
      TSTypeReference(node) {
        const name = node.typeName.type === "Identifier" ? node.typeName.name : undefined;
        if (!MIRROR_TYPES.has(name) || isShadowed(node, name)) return;

        context.report({ node, messageId: "mirroredSignature", data: { name } });
      },
    };
  },
});
