import { defineRule } from "../define-rule.mjs";

// A service throws a HandledError subclass and a client reads its `code`, so
// both sides need the class - it cannot live in the process package the
// client may not import.

const HANDLED_ERROR_PACKAGE = "@langwatch/handled-error";

function errorsFileOf(file) {
  const root = file.enterprise ? `enterprise/modules/${file.feature}` : `modules/${file.feature}`;
  return `${root}/contract/src/${file.feature}.errors.ts`;
}

function importedFromHandledError(declaration) {
  if (declaration.importKind === "type" || declaration.source.value !== HANDLED_ERROR_PACKAGE) {
    return [];
  }
  return declaration.specifiers
    .filter((specifier) => specifier.importKind !== "type")
    .map((specifier) => specifier.local.name);
}

/** Whether `name` reaches `@langwatch/handled-error` through imports and this file's classes. */
function isHandledErrorName(name, facts, seen = new Set()) {
  if (name === "HandledError" || facts.handledImports.has(name)) return true;
  if (seen.has(name)) return false;
  const parent = facts.localParents.get(name);
  return parent !== undefined && isHandledErrorName(parent, facts, seen.add(name));
}

export const handledErrorOutsideContractRule = defineRule({
  name: "handled-error-outside-contract",
  kind: "problem",
  applies: (file) => file.isProduction && file.role === "process" && Boolean(file.feature),
  messages: {
    handledError: {
      what: "`{{name}}` is a `HandledError` subclass (it extends `{{parent}}`) declared in `{{path}}`.",
      why: "A service throws it and a client reads its code, so both sides need the class and neither may import a process package.",
      fix: "Move it to `{{errorsFile}}`.",
    },
  },
  create(context, file) {
    const facts = { handledImports: new Set(), localParents: new Map() };
    const classes = [];

    function collect(node) {
      if (node.superClass?.type !== "Identifier") return;
      classes.push(node);
      if (node.id?.name) facts.localParents.set(node.id.name, node.superClass.name);
    }

    return {
      ImportDeclaration(node) {
        for (const name of importedFromHandledError(node)) facts.handledImports.add(name);
      },
      ClassDeclaration: collect,
      ClassExpression: collect,
      "Program:exit"() {
        for (const node of classes) {
          if (!isHandledErrorName(node.superClass.name, facts)) continue;
          context.report({
            node,
            messageId: "handledError",
            data: {
              name: node.id?.name ?? "<anonymous>",
              parent: node.superClass.name,
              path: file.workspacePath,
              errorsFile: errorsFileOf(file),
            },
          });
        }
      },
    };
  },
});
