import { isBaselined } from "../baseline.mjs";
import { defineRule } from "../define-rule.mjs";

// A service throws a HandledError subclass and a client reads its `code`, so
// both sides need the class - it cannot live in the server package the
// client may not import.

const SERVER_SOURCE = /^(?:enterprise\/)?modules\/([^/]+)\/server\/src\/.+\.[cm]?[jt]sx?$/;

function moduleOf(workspacePath) {
  return workspacePath.match(SERVER_SOURCE)?.[1];
}

function errorsFileOf(workspacePath, module) {
  const enterprise = workspacePath.startsWith("enterprise/");
  const root = enterprise ? `enterprise/modules/${module}` : `modules/${module}`;
  return `${root}/contract/src/${module}.errors.ts`;
}

export const handledErrorOutsideContractRule = defineRule({
  name: "handled-error-outside-contract",
  kind: "problem",
  applies: (file) => file.isProduction && Boolean(moduleOf(file.workspacePath)),
  messages: {
    handledError: {
      what: "`{{name}}` extends `HandledError` in `{{path}}`.",
      why: "A service throws it and a client reads its code, so both sides need the class and neither may import a server package.",
      fix: "Move it to `{{errorsFile}}`.",
    },
  },
  create(context, file) {
    const module = moduleOf(file.workspacePath);
    if (
      isBaselined({
        cwd: context.cwd,
        file: file.workspacePath,
        rule: "handled-error-outside-contract",
      })
    ) {
      return {};
    }

    function check(node) {
      if (node.superClass?.type !== "Identifier" || node.superClass.name !== "HandledError") return;
      context.report({
        node,
        messageId: "handledError",
        data: {
          name: node.id?.name ?? "<anonymous>",
          path: file.workspacePath,
          errorsFile: errorsFileOf(file.workspacePath, module),
        },
      });
    }

    return { ClassDeclaration: check, ClassExpression: check };
  },
});
