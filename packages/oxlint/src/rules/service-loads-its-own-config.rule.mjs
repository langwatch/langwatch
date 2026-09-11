import { isBaselined } from "../baseline.mjs";
import { defineRule } from "../define-rule.mjs";
import { isEnvironmentObject, staticPropertyName } from "./secrets-through-source.rule.mjs";

// A service or adapter takes its configuration as a named member of the
// argument object `create` receives, resolved once at the composition root -
// see fc80f65635, where three methods each re-validated Auth0 credentials the
// caller already held instead of being handed one validated config.

const SERVICE_OR_ADAPTER_SOURCE =
  /^(?:enterprise\/)?modules\/[^/]+\/server\/src\/(?:services|adapters)\/.+\.[cm]?[jt]sx?$/;
const CONFIG_FUNCTION_NAMES = new Set(["loadConfig", "resolveConfig", "readConfig"]);

function isFunctionLike(node) {
  return node?.type === "FunctionExpression" || node?.type === "ArrowFunctionExpression";
}

export const serviceLoadsItsOwnConfigRule = defineRule({
  name: "service-loads-its-own-config",
  kind: "problem",
  applies: (file) => file.isProduction && SERVICE_OR_ADAPTER_SOURCE.test(file.workspacePath),
  messages: {
    configFunction: {
      what: "`{{name}}` in `{{path}}` resolves its own configuration.",
      why: "A caller that already validated its config forces every callee to re-validate what it was handed.",
      fix: "Delete it; add a named `config` member to the argument object `create` takes and resolve it once at the composition root.",
    },
    environmentRead: {
      what: "`{{path}}` reads `process.env.{{key}}` directly instead of taking config as an argument.",
      why: "A caller that already validated its config forces every callee to re-validate what it was handed.",
      fix: "Add a named member to the argument object `create` takes and resolve it once at the composition root.",
    },
  },
  create(context, file) {
    if (
      isBaselined({
        cwd: context.cwd,
        file: file.workspacePath,
        rule: "service-loads-its-own-config",
      })
    ) {
      return {};
    }

    function reportFunction(node, name) {
      context.report({ node, messageId: "configFunction", data: { name, path: file.workspacePath } });
    }

    return {
      FunctionDeclaration(node) {
        if (node.id && CONFIG_FUNCTION_NAMES.has(node.id.name)) reportFunction(node, node.id.name);
      },
      VariableDeclarator(node) {
        if (node.id.type === "Identifier" && CONFIG_FUNCTION_NAMES.has(node.id.name) && isFunctionLike(node.init)) {
          reportFunction(node, node.id.name);
        }
      },
      MethodDefinition(node) {
        if (!node.computed && node.key.type === "Identifier" && CONFIG_FUNCTION_NAMES.has(node.key.name)) {
          reportFunction(node, node.key.name);
        }
      },
      Property(node) {
        if (
          !node.computed &&
          node.key.type === "Identifier" &&
          CONFIG_FUNCTION_NAMES.has(node.key.name) &&
          isFunctionLike(node.value)
        ) {
          reportFunction(node, node.key.name);
        }
      },
      MemberExpression(node) {
        if (!isEnvironmentObject(node.object)) return;
        const key = staticPropertyName(node);
        context.report({
          node,
          messageId: "environmentRead",
          data: { path: file.workspacePath, key: key ?? "a dynamic key" },
        });
      },
    };
  },
});
