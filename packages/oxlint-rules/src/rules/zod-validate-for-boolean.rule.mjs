import { defineRule } from "../define-rule.mjs";
import { memberName } from "./zod-schema-origin.mjs";

const EXCLUDED =
  /^sdks\/|(?:^|\/)(?:generated|dist|node_modules)\/|(?:\.generated|\.d)\.[cm]?[jt]sx?$/;
const SAFE_PARSES = new Set(["safeParse", "safeParseAsync"]);
const VALIDATORS = { safeParse: "validate", safeParseAsync: "validateAsync" };

function isGoverned(file) {
  return !EXCLUDED.test(file.workspacePath);
}

export const zodValidateForBooleanRule = defineRule({
  name: "zod-validate-for-boolean",
  kind: "problem",
  applies: isGoverned,
  messages: {
    useValidate: {
      what: "`.{{method}}(…).success` builds a full parse result only to read its flag.",
      why: "`.validate()` answers the same boolean without building the output or the error, up to 35x faster on a compiled schema.",
      fix: "Write `.{{validator}}(…)` with the same argument in place of `.{{method}}(…).success`.",
    },
  },
  create(context) {
    return {
      MemberExpression(node) {
        if (memberName(node) !== "success") return;
        const awaited = node.object?.type === "AwaitExpression";
        const call = awaited ? node.object.argument : node.object;
        if (call?.type !== "CallExpression") return;
        const method = memberName(call.callee);
        if (!SAFE_PARSES.has(method) || awaited !== (method === "safeParseAsync")) return;
        context.report({
          node,
          messageId: "useValidate",
          data: { method, validator: VALIDATORS[method] },
        });
      },
    };
  },
});
