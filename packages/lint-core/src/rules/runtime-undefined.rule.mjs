import { defineRule } from "../define-rule.mjs";

// Not wired into `.oxlintrc.architecture.json` (see the lint review, section
// 0.3): kept defined and tested, migrated like every other rule, deliberately
// left disconnected until someone decides to wire it in or delete it.

function hasUndefinedBinding(pattern) {
  if (!pattern) return false;
  if (pattern.type === "Identifier") return pattern.name === "undefined";
  if (pattern.type === "AssignmentPattern") return hasUndefinedBinding(pattern.left);
  if (pattern.type === "RestElement") return hasUndefinedBinding(pattern.argument);
  if (pattern.type === "ArrayPattern") return pattern.elements.some(hasUndefinedBinding);
  if (pattern.type === "ObjectPattern") {
    return pattern.properties.some((property) =>
      property.type === "RestElement"
        ? hasUndefinedBinding(property.argument)
        : hasUndefinedBinding(property.value),
    );
  }
  return false;
}

function declaresUndefined(statement) {
  const declaration =
    statement.type === "ExportNamedDeclaration" ? statement.declaration : statement;
  return (
    declaration?.type === "VariableDeclaration" &&
    declaration.declarations.some((item) => hasUndefinedBinding(item.id))
  );
}

// Oxc's plugin context does not expose ESLint's scope manager. Conservatively
// skip a reference whenever an enclosing scope declares `undefined`.
function isShadowedUndefined(node) {
  let current = node.parent;
  while (current) {
    if (
      (current.type === "FunctionDeclaration" ||
        current.type === "FunctionExpression" ||
        current.type === "ArrowFunctionExpression") &&
      current.params.some(hasUndefinedBinding)
    ) {
      return true;
    }
    if (current.type === "CatchClause" && hasUndefinedBinding(current.param)) return true;
    if (
      (current.type === "BlockStatement" || current.type === "Program") &&
      current.body.some(declaresUndefined)
    ) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

function isTypePosition(node) {
  let parent = node.parent;
  while (parent) {
    if (!parent.type?.startsWith("TS")) return false;
    // The expression side of an assertion remains runtime JavaScript. The
    // annotation/type-parameter side is handled by the generic TS branch.
    if (
      (parent.type === "TSAsExpression" ||
        parent.type === "TSTypeAssertion" ||
        parent.type === "TSNonNullExpression" ||
        parent.type === "TSSatisfiesExpression" ||
        parent.type === "TSInstantiationExpression") &&
      parent.expression === node
    ) {
      return false;
    }
    if (parent.type === "TSTypeQuery" && parent.exprName === node) return true;
    return true;
  }
  return false;
}

function isBindingPosition(node) {
  let current = node;
  let parent = node.parent;
  while (parent) {
    if (parent.type === "AssignmentPattern") return parent.left === current;
    if (parent.type === "RestElement") return true;
    if (parent.type === "VariableDeclarator") return parent.id === current;
    if (
      (parent.type === "FunctionDeclaration" ||
        parent.type === "FunctionExpression" ||
        parent.type === "ArrowFunctionExpression") &&
      parent.params.includes(current)
    ) {
      return true;
    }
    if (parent.type === "CatchClause" && parent.param === current) return true;
    if (parent.type === "Property" && parent.parent?.type === "ObjectPattern") {
      return true;
    }
    if (parent.type === "ObjectPattern" || parent.type === "ArrayPattern") return true;
    current = parent;
    parent = parent.parent;
  }
  return false;
}

function isNonValueIdentifier(node) {
  const parent = node.parent;
  if (!parent) return false;
  if (
    parent.type === "ImportSpecifier" ||
    parent.type === "ImportDefaultSpecifier" ||
    parent.type === "ImportNamespaceSpecifier" ||
    parent.type === "ExportSpecifier"
  ) {
    return true;
  }
  if (
    (parent.type === "MemberExpression" || parent.type === "OptionalMemberExpression") &&
    parent.property === node &&
    !parent.computed
  ) {
    return true;
  }
  if (
    (parent.type === "MethodDefinition" ||
      parent.type === "PropertyDefinition" ||
      parent.type === "TSPropertySignature" ||
      parent.type === "TSMethodSignature") &&
    parent.key === node &&
    !parent.computed
  ) {
    return true;
  }
  if (parent.type === "Property" && parent.key === node && !parent.computed) {
    // Object-literal shorthand is both key and value. It is fixed by
    // expanding the shorthand; object-pattern shorthand is a binding.
    if (parent.shorthand && parent.parent?.type === "ObjectExpression") {
      return parent.value !== node;
    }
    return true;
  }
  if (
    (parent.type === "LabeledStatement" ||
      parent.type === "BreakStatement" ||
      parent.type === "ContinueStatement") &&
    parent.label === node
  ) {
    return true;
  }
  if (parent.type === "TSQualifiedName" || parent.type === "TSTypeQuery") return true;
  return isBindingPosition(node) || isTypePosition(node);
}

export const runtimeUndefinedRule = defineRule({
  name: "runtime-undefined",
  kind: "style",
  fixable: "code",
  messages: {
    runtimeUndefined: {
      what: "Use void 0 instead of the ambient undefined value.",
      fix: "Replace `undefined` with `void 0`.",
    },
  },
  create(context) {
    return {
      Identifier(node) {
        if (node.name !== "undefined" || isNonValueIdentifier(node) || isShadowedUndefined(node)) {
          return;
        }
        context.report({
          node,
          messageId: "runtimeUndefined",
          fix(fixer) {
            const parent = node.parent;
            if (
              parent?.type === "Property" &&
              parent.shorthand &&
              parent.parent?.type === "ObjectExpression"
            ) {
              return fixer.replaceText(node, "undefined: void 0");
            }
            return fixer.replaceText(node, "void 0");
          },
        });
      },
    };
  },
});
