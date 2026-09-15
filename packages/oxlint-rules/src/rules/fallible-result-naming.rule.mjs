import { walk } from "../ast.mjs";
import { defineRule } from "../define-rule.mjs";

// Every source file of a module answers the same way: a lookup that may find
// nothing is `find*`, and nothing hedges with `try`. Tests and fixtures are
// the only files outside the rule.
const FALLIBLE_RESULT_MODULE = /^src\/(?!.*__tests__\/)(?!.*\.fixture\.ts$)(?!.*\.test\.ts$).*\.ts$/;

// `tryPrefix` fires only where a real catch turns a failure into an absence.
// A census found 96.2% of flagged sites had no such catch (no body at all, or
// a body with no catch/`.catch(`). That is still a naming defect, but
// `langwatch/no-try-prefix` says so without claiming a catch it cannot see.
const FUNCTION_BOUNDARY = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);
const TRY_PREFIX = /^try[A-Z]/;

/** Shared with `no-try-prefix` so the two rules cannot drift apart on what counts as hedged. */
export function isTryPrefixedName(name) {
  return TRY_PREFIX.test(name);
}

function isNullishExpression(node) {
  if (!node) return false;
  if (node.type === "Literal" && node.value === null) return true;
  if (node.type === "Identifier" && node.name === "undefined") return true;
  if (node.type === "UnaryExpression" && node.operator === "void") return true;
  return false;
}

function isNullishReturnArgument(argument) {
  return argument == null || isNullishExpression(argument);
}

// Walks `root` for a node `matches`, without crossing into a nested function's
// own body — a callback's error handling is not this declaration's.
function scopedSearch(root, matches) {
  let found = false;
  walk(root, (node) => {
    if (found) return false;
    if (matches(node)) {
      found = true;
      return false;
    }
    if (node !== root && FUNCTION_BOUNDARY.has(node.type)) return false;
    return true;
  });
  return found;
}

const hasThrowInScope = (root) => scopedSearch(root, (node) => node.type === "ThrowStatement");
const hasNullishReturnInScope = (root) =>
  scopedSearch(root, (node) => node.type === "ReturnStatement" && isNullishReturnArgument(node.argument));

function isSwallowingCatchClause(node) {
  const block = node.body;
  if (hasThrowInScope(block)) return false;
  if (block.body.length === 0) return true;
  return hasNullishReturnInScope(block);
}

function isCatchChainCall(node) {
  return (
    node.type === "CallExpression" &&
    node.callee.type === "MemberExpression" &&
    !node.callee.computed &&
    node.callee.property.type === "Identifier" &&
    node.callee.property.name === "catch"
  );
}

function isSwallowingCatchChain(node) {
  const handler = node.arguments[0];
  if (!handler) return false;
  if (handler.type !== "ArrowFunctionExpression" && handler.type !== "FunctionExpression") return false;
  if (handler.body.type !== "BlockStatement") return isNullishExpression(handler.body);
  return !hasThrowInScope(handler.body) && hasNullishReturnInScope(handler.body);
}

// Classifies one node while walking a declaration's body for a swallow:
// "found" ends the walk with a match, "skip" prunes the subtree without
// matching, "continue" leaves the walk to descend as normal.
function swallowClassification(node, root) {
  if (node.type === "CatchClause") return isSwallowingCatchClause(node) ? "found" : "skip";
  if (isCatchChainCall(node)) return isSwallowingCatchChain(node) ? "found" : "skip";
  if (node !== root && FUNCTION_BOUNDARY.has(node.type)) return "skip";
  return "continue";
}

/**
 * Whether a declaration's own body converts a caught error or a rejected
 * promise into a nullish value. `undefined`/no body (an interface signature
 * or an abstract method) never matches — there is nothing to walk.
 */
function bodyIsSwallow(body) {
  if (!body) return false;

  let found = false;
  walk(body, (node) => {
    if (found) return false;
    const classification = swallowClassification(node, body);
    if (classification === "found") found = true;
    return classification === "continue";
  });

  return found;
}

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

export function isFallibleResultModule(file) {
  if (file.role !== "contract" && file.role !== "server") return false;
  if (file.layoutVersion !== 0) return false;
  if (!file.relative?.startsWith("src/")) return false;
  return FALLIBLE_RESULT_MODULE.test(file.relative);
}

export function withoutPrefix(name, prefix) {
  const rest = name.slice(prefix.length);
  return rest.charAt(0).toLowerCase() + rest.slice(1);
}

export const fallibleResultNamingRule = defineRule({
  name: "fallible-result-naming",
  kind: "problem",
  applies: isFallibleResultModule,
  messages: {
    tryPrefix: {
      what: "`{{name}}` hedges: it catches the failure and hands the caller null or undefined instead of the reason there is none.",
      why: "A caller that cannot tell absence from breakage writes the same branch for both.",
      fix:
        "Name it `{{plain}}` and make the body throw on failure: delete the catch that"
        + " turns the failure into null or undefined, so the caller gets the answer or the"
        + " reason there is none. Keep a nullable return type only when `{{plain}}` begins"
        + " with `find` and its callers branch on absence; otherwise drop null and"
        + " undefined from the return type as well.",
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
    const check = (key, returnType, accessibility, { isSwallow = false, typeStatedElsewhere = false } = {}) => {
      if (!key || key.type !== "Identifier") return;
      if (accessibility === "private") return;
      const name = key.name;

      if (isSwallow) {
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

      // A try-prefixed name's nullable-without-find defect is `no-try-prefix`'s
      // to report — that rule already names the same rename for every try*
      // name, swallow or not. Restating it here would be the same fix twice.
      if (containsNullableType(returnType) && !/^find[A-Z]?/.test(name) && !isTryPrefixedName(name)) {
        context.report({ node: key, messageId: "nullableWithoutFind", data: { name } });
      }
    };

    // A class that `implements` an interface already states every result type
    // there; repeating it on the method would restate the contract.
    const implementsInterface = (node) => (node.parent?.parent?.implements?.length ?? 0) > 0;

    const isSwallowCandidate = (key) => key?.type === "Identifier" && isTryPrefixedName(key.name);

    const checkMethod = (node) => {
      if (node.kind !== "method" || node.computed) return;
      const body = node.value?.body;
      check(node.key, node.value?.returnType?.typeAnnotation, node.accessibility, {
        isSwallow: isSwallowCandidate(node.key) && bodyIsSwallow(body),
        typeStatedElsewhere: implementsInterface(node),
      });
    };

    return {
      MethodDefinition: checkMethod,
      TSAbstractMethodDefinition: checkMethod,
      TSMethodSignature(node) {
        if (node.computed) return;
        check(node.key, node.returnType?.typeAnnotation, undefined);
      },
      FunctionDeclaration(node) {
        check(node.id, node.returnType?.typeAnnotation, undefined, {
          isSwallow: isSwallowCandidate(node.id) && bodyIsSwallow(node.body),
        });
      },
    };
  },
});
