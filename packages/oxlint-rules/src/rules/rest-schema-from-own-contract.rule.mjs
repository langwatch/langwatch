import { walk } from "../ast.mjs";
import { defineRule } from "../define-rule.mjs";
import { memberName } from "./zod-schema-origin.mjs";

// The REST transport law (ARCHITECTURE-LAW.md, "Transport law"): a `.rest.ts`
// or `.trpc.ts` file under a module's `server` package declares routes only.
// Every schema it needs already exists in its OWN module's contract package -
// never authored here, and never borrowed from another module's contract.

const FACTORIES = new Set(["object", "record", "array", "union", "enum"]);
const CONTRACT_SOURCE = /^@langwatch\/(enterprise-)?([a-z0-9]+(?:-[a-z0-9]+)*)-contract(?:\/.*)?$/;
const HANDLER_BODY = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);

function isRestTransportSource(file) {
  return file.isProduction && file.role === "process" && /\.(rest|trpc)\.ts$/.test(file.sourcePath ?? "");
}

/** The module specifier an identifier was imported from; undefined otherwise. */
function importSourceOf(context, identifier) {
  if (identifier?.type !== "Identifier") return void 0;
  let scope = context.sourceCode.getScope(identifier);
  while (scope && !scope.set.has(identifier.name)) scope = scope.upper;
  const definition = scope?.set.get(identifier.name)?.defs[0];
  return definition?.type === "ImportBinding" ? definition.parent.source.value : void 0;
}

/** The module a contract package specifier names, or undefined for anything else. */
function contractModuleOf(source) {
  const match = CONTRACT_SOURCE.exec(source);
  return match ? { enterprise: Boolean(match[1]), feature: match[2] } : void 0;
}

export const restSchemaFromOwnContractRule = defineRule({
  name: "rest-schema-from-own-contract",
  kind: "problem",
  applies: isRestTransportSource,
  messages: {
    inlineSchema: {
      what: "`z.{{factory}}(...)` builds a schema inline in `{{path}}`.",
      why: "A transport file declares routes; every side of the wire reads the shape through the contract.",
      fix: "Move it to the module's own contract package and import it here.",
    },
    foreignContract: {
      what: "`{{source}}` is another module's contract, imported into `{{module}}`'s transport.",
      why: "A cross-module schema need means the shape belongs in this module's own contract, or the route belongs in the other module.",
      fix: "Import the shape from `{{module}}`'s own contract instead, or move this route to the module that owns `{{source}}`.",
    },
  },
  create(context, file) {
    return {
      Program(program) {
        walk(program, (node) => {
          if (HANDLER_BODY.has(node.type)) return false; // a handler body is runtime, not the declaration
          if (node.type !== "CallExpression" || node.callee.type !== "MemberExpression") return;

          const factory = memberName(node.callee);
          if (!FACTORIES.has(factory)) return;
          if (importSourceOf(context, node.callee.object) !== "zod") return;

          context.report({
            node,
            messageId: "inlineSchema",
            data: { factory, path: file.workspacePath },
          });
        });

        for (const statement of program.body) {
          if (statement.type !== "ImportDeclaration") continue;

          const imported = contractModuleOf(statement.source.value);
          if (!imported) continue;
          if (imported.enterprise === file.enterprise && imported.feature === file.feature) continue;

          context.report({
            node: statement,
            messageId: "foreignContract",
            data: { source: statement.source.value, module: file.feature },
          });
        }
      },
    };
  },
});
