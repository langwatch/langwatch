import { defineRule } from "../define-rule.mjs";

const FALLIBLE_RESULT_MODULE = /\.(?:api|app|service|port|repository|store)\.ts$/;

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

function isFallibleResultModule(file) {
  if (file.role !== "contract" && file.role !== "server") return false;
  if (file.layoutVersion !== 0) return false;
  if (!file.relative?.startsWith("src/")) return false;
  return FALLIBLE_RESULT_MODULE.test(file.relative);
}

function withoutPrefix(name, prefix) {
  const rest = name.slice(prefix.length);
  return rest.charAt(0).toLowerCase() + rest.slice(1);
}

export const fallibleResultNamingRule = defineRule({
  name: "fallible-result-naming",
  kind: "problem",
  applies: isFallibleResultModule,
  messages: {
    tryPrefix: {
      what: "`{{name}}` hedges: a `try` method hands the caller a maybe instead of an answer.",
      fix: "Name it `{{plain}}` and throw the domain error when it cannot answer; if absence is a normal outcome the caller branches on, name it `find*` and return undefined.",
    },
    requirePrefix: {
      what: "Rename `{{name}}`: drop the `require` prefix; a method already returns or throws.",
      fix: "Rename the method without the `require` prefix.",
    },
    noResultType: {
      what: "`{{name}}` has no explicit result type, so its absence contract cannot be enforced.",
      fix: "Add an explicit return type.",
    },
    nullableWithoutFind: {
      what: "`{{name}}` can return null/undefined, but only a `find*` method may answer with absence.",
      fix: "Throw the domain error and drop the nullable from the type, or name it `find*`.",
    },
  },
  create(context) {
    const check = (key, returnType, accessibility, typeStatedElsewhere = false) => {
      if (!key || key.type !== "Identifier") return;
      if (accessibility === "private") return;
      const name = key.name;

      if (/^try[A-Z]/.test(name)) {
        context.report({
          node: key,
          messageId: "tryPrefix",
          data: { name, plain: withoutPrefix(name, "try") },
        });
        return;
      }

      if (/^require[A-Z]/.test(name)) {
        context.report({ node: key, messageId: "requirePrefix", data: { name } });
      }

      if (!returnType) {
        if (typeStatedElsewhere) return;
        context.report({ node: key, messageId: "noResultType", data: { name } });
        return;
      }

      if (containsNullableType(returnType) && !/^find[A-Z]?/.test(name)) {
        context.report({ node: key, messageId: "nullableWithoutFind", data: { name } });
      }
    };

    // A class that `implements` an interface already states every result type
    // there; repeating it on the method would restate the contract.
    const implementsInterface = (node) => (node.parent?.parent?.implements?.length ?? 0) > 0;

    const checkMethod = (node) => {
      if (node.kind !== "method" || node.computed) return;
      check(
        node.key,
        node.value?.returnType?.typeAnnotation,
        node.accessibility,
        implementsInterface(node),
      );
    };

    return {
      MethodDefinition: checkMethod,
      TSAbstractMethodDefinition: checkMethod,
      TSMethodSignature(node) {
        if (node.computed) return;
        check(node.key, node.returnType?.typeAnnotation, undefined);
      },
      FunctionDeclaration(node) {
        check(node.id, node.returnType?.typeAnnotation, undefined);
      },
    };
  },
});
