import { defineRule } from "../define-rule.mjs";
import { isErrorToastType, isToasterGovernedCode } from "../toaster-shapes.mjs";

// A feature-web module carries no toaster of its own. A renderer built with `createToaster` is a
// second toast surface the composing application never mounts, so whatever it shows nobody sees.
// A published `toaster` that shapes its own failures is a second copy-authoring surface beside
// the code-keyed registry. A local toaster may route: hand every failure to `host.failed(...)` and
// render nothing. Same detection as the retired design-system scan.

function exportsToaster(node) {
  const declaration = node.declaration;
  if (declaration?.type === "FunctionDeclaration") return declaration.id?.name === "toaster";
  if (declaration?.type === "VariableDeclaration") {
    return declaration.declarations.some(
      (declarator) => declarator.id?.type === "Identifier" && declarator.id.name === "toaster",
    );
  }

  return (node.specifiers ?? []).some((specifier) => specifier.local?.name === "toaster");
}

export const noModuleToasterRule = defineRule({
  name: "no-module-toaster",
  kind: "problem",
  applies: (file) => isToasterGovernedCode(file),
  messages: {
    ownRenderer: {
      what: "This module builds a toast renderer of its own with `createToaster`.",
      why: "The composing application never mounts a module's renderer, so every toast raised on it is invisible.",
      fix: "Use the Design System toaster for notices and the host port (`showErrorToast` or `host.failed`) for failures. Read the `browser-telemetry-and-errors` skill.",
    },
    ownFailureCopy: {
      what: "This module publishes a `toaster` that shapes failures itself.",
      why: "A published toaster that writes its own failure copy is a second authoring surface beside the code-keyed registry.",
      fix: "Route every failure to `host.failed({ error, fallbackTitle })` and render nothing, or move the toaster into the Design System. Read the `browser-telemetry-and-errors` skill.",
    },
  },
  create(context) {
    let publishes = false;
    let routes = false;
    const failures = [];

    return {
      ExportNamedDeclaration(node) {
        if (exportsToaster(node)) publishes = true;
      },
      CallExpression(node) {
        const callee = node.callee;
        if (callee?.type === "Identifier" && callee.name === "createToaster") {
          context.report({ node, messageId: "ownRenderer" });
        }
        if (
          callee?.type === "MemberExpression" &&
          !callee.computed &&
          callee.property?.name === "failed"
        ) {
          routes = true;
        }
      },
      Property(node) {
        if (isErrorToastType(node)) failures.push(node);
      },
      "Program:exit"() {
        if (!publishes || routes) return;
        for (const node of failures) context.report({ node, messageId: "ownFailureCopy" });
      },
    };
  },
});
