import { defineRule } from "../define-rule.mjs";

// A plan gate is declared on the route (`withEntitlement(entitlement, { feature, when })`)
// and the framework asks it after access. A module that throws the refusal itself
// forks the 401 -> 403 -> 402 order and the refusal's shape. A gate that needs
// loaded data lives in `services/`, which this rule leaves alone.

const REFUSAL_HELPERS = new Set(["assertEnterprisePlan", "assertEnterprisePlanType"]);
const REFUSAL_CLASS = "EnterprisePlanRequiredError";

export const noHandRolledPlanGateRule = defineRule({
  name: "no-hand-rolled-plan-gate",
  kind: "problem",
  applies: (file) =>
    file.isProduction &&
    file.role === "process" &&
    Boolean(file.feature) &&
    (file.layer === "transport" || Boolean(file.sourcePath?.startsWith("app/"))),
  messages: {
    handRolledPlanGate: {
      what: "`{{refusal}}` refuses a plan in `{{path}}`, in the app or transport layer.",
      why: "The framework asks a declared plan gate after access, so a caller without permission never learns the plan's limits.",
      fix: 'Declare `.withEntitlement("enterprise", { feature, when })` on the route or procedure and delete this refusal; a gate that needs loaded data belongs in a service method. Read the `module-dependencies` skill.',
    },
  },
  create(context, file) {
    function report(node, refusal) {
      context.report({
        node,
        messageId: "handRolledPlanGate",
        data: { refusal, path: file.workspacePath },
      });
    }

    return {
      NewExpression(node) {
        if (node.callee.type === "Identifier" && node.callee.name === REFUSAL_CLASS) {
          report(node, `new ${REFUSAL_CLASS}(...)`);
        }
      },
      CallExpression(node) {
        if (node.callee.type === "Identifier" && REFUSAL_HELPERS.has(node.callee.name)) {
          report(node, `${node.callee.name}(...)`);
        }
      },
    };
  },
});
