import { defineRule } from "../define-rule.mjs";

// A service takes its configuration as a named member of the argument object
// `create` receives, resolved once where the process composes the module.
// Reading `process.env` is environment-boundaries' to refuse, not this rule's.

const CONFIG_FUNCTION_NAMES = new Set(["loadConfig", "resolveConfig", "readConfig"]);

function isFunctionLike(node) {
  return node?.type === "FunctionExpression" || node?.type === "ArrowFunctionExpression";
}

function isConfigVariableDeclarator(node) {
  if (node.id.type !== "Identifier") return false;
  if (!CONFIG_FUNCTION_NAMES.has(node.id.name)) return false;
  return isFunctionLike(node.init);
}

function isConfigProperty(node) {
  if (node.computed) return false;
  if (node.key.type !== "Identifier") return false;
  if (!CONFIG_FUNCTION_NAMES.has(node.key.name)) return false;
  return isFunctionLike(node.value);
}

export const serviceLoadsItsOwnConfigRule = defineRule({
  name: "service-loads-its-own-config",
  kind: "problem",
  applies: (file) => !file.isTest && file.layer === "services",
  messages: {
    configFunction: {
      what: "`{{name}}` in `{{path}}` resolves its own configuration.",
      why: "A caller that already validated its config forces every callee to re-validate what it was handed.",
      fix: "Delete it; add a named `config` member to the argument object `create` takes and resolve it once at the composition root.",
    },
  },
  create(context, file) {
    function reportFunction(node, name) {
      context.report({
        node,
        messageId: "configFunction",
        data: { name, path: file.workspacePath },
      });
    }

    return {
      FunctionDeclaration(node) {
        if (node.id && CONFIG_FUNCTION_NAMES.has(node.id.name)) reportFunction(node, node.id.name);
      },
      VariableDeclarator(node) {
        if (!isConfigVariableDeclarator(node)) return;
        reportFunction(node, node.id.name);
      },
      MethodDefinition(node) {
        if (
          !node.computed &&
          node.key.type === "Identifier" &&
          CONFIG_FUNCTION_NAMES.has(node.key.name)
        ) {
          reportFunction(node, node.key.name);
        }
      },
      Property(node) {
        if (!isConfigProperty(node)) return;
        reportFunction(node, node.key.name);
      },
    };
  },
});
