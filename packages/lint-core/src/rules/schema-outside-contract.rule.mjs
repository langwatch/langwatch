import { isBaselined } from "../baseline.mjs";
import { defineRule } from "../define-rule.mjs";
import { unwrap } from "./zod-schema-origin.mjs";

// A transport file declares routes and imports its shapes; it does not
// author them. The browser, the SDK and another module all read the wire
// through the contract package, and none of them may import a server
// package, so a schema declared here is a shape only the server can see -
// every other side of the wire ends up with a hand-written copy that drifts.

const TRANSPORT_SOURCE =
  /^(?:enterprise\/)?modules\/([^/]+)\/server\/src\/transport\/.+\.[cm]?[jt]sx?$/;
const GENERATED = /(?:^|\/)(?:generated|dist|node_modules)\/|(?:\.generated|\.d)\.[cm]?[jt]sx?$/;

function moduleOf(workspacePath) {
  return workspacePath.match(TRANSPORT_SOURCE)?.[1];
}

function contractPathOf(workspacePath, module) {
  const enterprise = workspacePath.startsWith("enterprise/");
  return enterprise ? `enterprise/modules/${module}/contract/src` : `modules/${module}/contract/src`;
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
 * Whether `node` is Zod vocabulary this file authors itself, rather than
 * imports: a call chain that bottoms out at the local `z` (imported from
 * "zod"), or at another top-level const this same file builds the same way.
 * Composing an identifier imported from anywhere else - the contract - stops
 * the chain without marking it authored here, which is the exemption for
 * `.extend`/`.pick`/`.omit`/`.merge` on an imported schema.
 */
function isAuthoredHere(node, context, locals, seen) {
  const value = unwrap(node);
  if (value?.type !== "CallExpression" || value.callee.type !== "MemberExpression") return false;
  const object = unwrap(value.callee.object);

  if (object.type !== "Identifier") return isAuthoredHere(object, context, locals, seen);

  const source = importSourceOf(context, object);
  if (source === "zod") return true;
  if (source !== void 0) return false;
  if (seen.has(object.name)) return false;

  const local = locals.get(object.name);
  return local ? isAuthoredHere(local, context, locals, new Set(seen).add(object.name)) : false;
}

function isSchemaSource(file) {
  return (
    file.isProduction && !GENERATED.test(file.workspacePath) && Boolean(moduleOf(file.workspacePath))
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
    if (isBaselined({ cwd: context.cwd, file: file.workspacePath, rule: "schema-outside-contract" })) {
      return {};
    }

    return {
      Program(program) {
        const locals = new Map();
        const candidates = [];

        for (const statement of program.body) {
          const exported = statement.type === "ExportNamedDeclaration";
          const declaration = exported ? statement.declaration : statement;
          if (declaration?.type !== "VariableDeclaration" || declaration.kind !== "const") continue;

          for (const declarator of declaration.declarations) {
            if (declarator.id.type !== "Identifier" || !declarator.init) continue;
            locals.set(declarator.id.name, declarator.init);
            candidates.push({ declarator, exported });
          }
        }

        for (const { declarator, exported } of candidates) {
          const name = declarator.id.name;
          if (!/Schema$/.test(name) && !exported) continue;
          if (!isAuthoredHere(declarator.init, context, locals, new Set())) continue;

          context.report({
            node: declarator,
            messageId: "schema",
            data: { name, path: file.workspacePath, contractPath: contractPathOf(file.workspacePath, module) },
          });
        }
      },
    };
  },
});
