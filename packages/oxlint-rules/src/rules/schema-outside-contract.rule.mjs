import { defineRule } from "../define-rule.mjs";
import { unwrap } from "./zod-schema-origin.mjs";

// A transport file declares routes and imports its shapes. A schema authored
// here is a shape only the process can see, so every other side of the wire
// (browser, SDK, peer module) ends up with a hand-written copy that drifts.

const TRANSPORT_SOURCE =
  /^(?:enterprise\/)?modules\/([^/]+)\/process\/src\/transport\/.+\.[cm]?[jt]sx?$/;
const ZOD_ENTRYPOINTS = new Set(["zod", "zod/v3", "zod/v4", "zod/mini", "zod/v4/mini"]);
const GENERATED = /(?:^|\/)(?:generated|dist|node_modules)\/|(?:\.generated|\.d)\.[cm]?[jt]sx?$/;

function moduleOf(workspacePath) {
  return workspacePath.match(TRANSPORT_SOURCE)?.[1];
}

function contractPathOf(workspacePath, module) {
  const enterprise = workspacePath.startsWith("enterprise/");
  return enterprise
    ? `enterprise/modules/${module}/contract/src`
    : `modules/${module}/contract/src`;
}

/** The module specifier an identifier was imported from, or undefined for anything else. */
function importSourceOf(context, identifier) {
  if (identifier?.type !== "Identifier") return void 0;
  let scope = context.sourceCode.getScope(identifier);
  while (scope && !scope.set.has(identifier.name)) scope = scope.upper;
  const definition = scope?.set.get(identifier.name)?.defs[0];
  if (definition?.type !== "ImportBinding") return void 0;
  if (definition.parent.importKind === "type" || definition.node.importKind === "type") {
    return void 0;
  }
  return definition.parent.source.value;
}

/**
 * Whether `node` is Zod vocabulary this file authors: a chain bottoming out
 * at the local `z` or another top-level const it builds. An identifier
 * imported from elsewhere stops the chain unmarked - the extend/pick/omit/merge exemption.
 */
function isAuthoredHere(node, context, locals, seen) {
  const value = unwrap(node);
  if (value?.type !== "CallExpression" || value.callee.type !== "MemberExpression") return false;
  const object = unwrap(value.callee.object);

  if (object.type !== "Identifier") return isAuthoredHere(object, context, locals, seen);

  const source = importSourceOf(context, object);
  if (ZOD_ENTRYPOINTS.has(source)) return true;
  if (source !== void 0) return false;
  if (seen.has(object.name)) return false;

  const local = locals.get(object.name);
  return local ? isAuthoredHere(local, context, locals, new Set(seen).add(object.name)) : false;
}

function constDeclarationOf(statement) {
  const exported = statement.type === "ExportNamedDeclaration";
  const declaration = exported ? statement.declaration : statement;
  if (declaration?.type !== "VariableDeclaration" || declaration.kind !== "const") return undefined;
  return { declaration, exported };
}

/** Every top-level `const name = …`, and whether it is exported. */
function topLevelConstants(program) {
  const locals = new Map();
  const candidates = [];
  for (const statement of program.body) {
    const found = constDeclarationOf(statement);
    if (!found) continue;
    for (const declarator of found.declaration.declarations) {
      if (declarator.id.type !== "Identifier" || !declarator.init) continue;
      locals.set(declarator.id.name, declarator.init);
      candidates.push({ declarator, exported: found.exported });
    }
  }
  return { candidates, locals };
}

function isSchemaSource(file) {
  return (
    file.isProduction &&
    !GENERATED.test(file.workspacePath) &&
    Boolean(moduleOf(file.workspacePath))
  );
}

export const schemaOutsideContractRule = defineRule({
  name: "schema-outside-contract",
  kind: "problem",
  applies: isSchemaSource,
  messages: {
    schema: {
      what: "`{{name}}` is a Zod schema declared in `{{path}}`.",
      why: "A transport file declares routes and imports its shapes; the vocabulary belongs to every side of the wire.",
      fix: "Move it to `{{contractPath}}` and import it here.",
    },
  },
  create(context, file) {
    const module = moduleOf(file.workspacePath);

    return {
      Program(program) {
        const { candidates, locals } = topLevelConstants(program);

        for (const { declarator, exported } of candidates) {
          const name = declarator.id.name;
          if (!name.endsWith("Schema") && !exported) continue;
          if (!isAuthoredHere(declarator.init, context, locals, new Set())) continue;

          context.report({
            node: declarator,
            messageId: "schema",
            data: {
              name,
              path: file.workspacePath,
              contractPath: contractPathOf(file.workspacePath, module),
            },
          });
        }
      },
    };
  },
});
