import { defineRule } from "../define-rule.mjs";

const FALLIBLE_RESULT_MODULE = /\.(?:service|port|repository|store)\.ts$/;

function promiseTypeArgument(node) {
  if (node.type !== "TSTypeReference") return undefined;
  if (node.typeName?.type !== "Identifier" || node.typeName.name !== "Promise") return undefined;
  const parameters = node.typeArguments?.params ?? [];
  return parameters.length === 1 ? parameters[0] : undefined;
}

function containsNullableType(node) {
  if (!node) return false;
  if (node.type === "TSUndefinedKeyword" || node.type === "TSNullKeyword") return true;
  if (node.type === "TSParenthesizedType") return containsNullableType(node.typeAnnotation);
  if (node.type === "TSUnionType") return node.types.some(containsNullableType);
  const promiseArgument = promiseTypeArgument(node);
  if (promiseArgument) return containsNullableType(promiseArgument);
  return false;
}

const NON_NULLABLE_TYPES = new Set([
  "TSStringKeyword",
  "TSNumberKeyword",
  "TSBooleanKeyword",
  "TSBigIntKeyword",
  "TSSymbolKeyword",
  "TSObjectKeyword",
  "TSVoidKeyword",
  "TSTypeLiteral",
  "TSArrayType",
  "TSTupleType",
  "TSFunctionType",
]);

function definitelyNonNullableType(node) {
  if (!node) return false;
  if (node.type === "TSParenthesizedType") return definitelyNonNullableType(node.typeAnnotation);
  if (node.type === "TSUnionType") return node.types.every(definitelyNonNullableType);
  const promiseArgument = promiseTypeArgument(node);
  if (promiseArgument) return definitelyNonNullableType(promiseArgument);
  if (node.type === "TSLiteralType") return node.literal?.type !== "NullLiteral";
  return NON_NULLABLE_TYPES.has(node.type);
}

function isFallibleResultModule(file) {
  if (file.role !== "contract" && file.role !== "server") return false;
  if (file.layoutVersion !== 0) return false;
  if (!file.relative?.startsWith("src/")) return false;
  return FALLIBLE_RESULT_MODULE.test(file.relative);
}

function capitalize(name) {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export const fallibleResultNamingRule = defineRule({
  name: "fallible-result-naming",
  kind: "problem",
  applies: isFallibleResultModule,
  messages: {
    requirePrefix: {
      what: "Rename `{{name}}`: drop the `require` prefix; a method already returns or throws.",
      fix: "Rename the method without the `require` prefix.",
    },
    noResultType: {
      what: "Capability {{name}} has no explicit result type, so its absence contract cannot be enforced.",
      fix: "Add an explicit return type.",
    },
    untriedAbsence: {
      what: "`{{name}}` can return null/undefined.",
      fix: "Rename it `try{{Name}}`, or make it throw and drop the nullable from the type.",
    },
    tryWithoutAbsence: {
      what: "`{{name}}` never returns null/undefined.",
      fix: "Drop the `try` prefix or widen the return type.",
    },
  },
  create(context) {
    const check = (node) => {
      if (node.kind !== "method" || node.computed) return;
      if (node.key?.type !== "Identifier") return;
      if (node.accessibility === "private") return;
      const name = node.key.name;
      // `requireById` — the imperative — is the redundant one: an ordinary
      // method already returns a value or throws. `required` is an adjective
      // the boolean-name policy allows, so it is not this.
      if (/^require[A-Z]/.test(name)) {
        context.report({ node: node.key, messageId: "requirePrefix", data: { name } });
      }
      const returnType = node.value?.returnType?.typeAnnotation;
      if (!returnType) {
        context.report({ node: node.key, messageId: "noResultType", data: { name } });
        return;
      }
      const optional = name.startsWith("try");
      if (containsNullableType(returnType) && !optional) {
        context.report({
          node: node.key,
          messageId: "untriedAbsence",
          data: { name, Name: capitalize(name) },
        });
        return;
      }
      if (!containsNullableType(returnType) && optional && definitelyNonNullableType(returnType)) {
        context.report({ node: node.key, messageId: "tryWithoutAbsence", data: { name } });
      }
    };

    return {
      MethodDefinition: check,
      TSAbstractMethodDefinition: check,
    };
  },
});
