import { defineRule } from "../define-rule.mjs";

// Every source file of a module answers the same way: a lookup that may find
// nothing is `find*`, and nothing hedges with `try`. Tests and fixtures are
// the only files outside the rule.
const FALLIBLE_RESULT_MODULE = /^src\/(?!.*__tests__\/)(?!.*\.fixture\.ts$)(?!.*\.test\.ts$).*\.ts$/;

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
      what: "`{{name}}` hedges: `try` names how the method behaves on failure, not what it answers.",
      why: "A caller that cannot tell absence from breakage writes the same branch for both.",
      fix:
        "Name it `{{plain}}` and make the body throw on failure — where the body catches"
        + " an error and returns null or undefined, delete that catch so the caller gets"
        + " the answer or the reason there is none. Keep a nullable return type only when"
        + " `{{plain}}` begins with `find` and its callers branch on absence; otherwise"
        + " drop null and undefined from the return type as well.",
    },
    requirePrefix: {
      what: "`{{name}}` carries a redundant `require` prefix: a method already answers or throws.",
      fix: "Name it `{{plain}}` and leave the body as it is.",
    },
    noResultType: {
      what: "`{{name}}` has no explicit result type, so its absence contract cannot be enforced.",
      fix:
        "Write the return type after the parameter list: `T` (or `Promise<T>`) when the"
        + " method always answers, and `T | null` only when `{{name}}` begins with `find`.",
    },
    nullableWithoutFind: {
      what: "`{{name}}` can answer null or undefined, but only a `find*` method may answer with absence.",
      fix:
        "Choose by what absence means here. If the caller branches on it, rename"
        + " `{{name}}` to `find<Noun>` for the thing it looks up — never `find` bolted"
        + " onto this name — and keep the nullable. If absence means the domain refused,"
        + " throw the domain error and drop null and undefined from the return type. If"
        + " this is a write whose target may normally be absent, return an explicit"
        + " result union instead of null.",
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
        context.report({
          node: key,
          messageId: "requirePrefix",
          data: { name, plain: withoutPrefix(name, "require") },
        });
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
