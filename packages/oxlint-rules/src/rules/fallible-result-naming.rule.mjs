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

// A repository answers `find*`; `get*`/`list*` on one is the service layer's
// vocabulary, not its own (CLAUDE.md's layer-vocabulary row). Scoped to the
// interface file and both backends by path, never by what the class extends
// or implements — that is what keeps this a per-file syntactic check.
const REPOSITORY_METHOD_FILE = /\/repositories\/(?:prisma\/|memory\/)?[^/]*\.repository\.ts$/;
const REPOSITORY_SERVICE_VOCABULARY = /^(get|list)([A-Z]|$)/;
const GET_VOCABULARY = /^get([A-Z]|$)/;

// A derivation is handed the value it derives from; absence from one means "the
// input carried none", not "no such record". The only fix this rule offers a
// nullable result is a `find*` rename, and since 2026-09-16 `find` states
// cardinality - it answers an array - so a derivation cannot take that name
// without lying about what it returns. Reporting it prescribes nothing.
//
// `infer`, `classify`, `detect`, `pick`, `describe` and `map` were added by
// ADR-146: they compute an answer from their argument exactly as the
// conversions above do. `inferOriginFromLegacyMarkers(span)` walks a table of
// legacy markers and answers nothing when none matches, which is a correct
// answer - `get*` would make it throw on a normal outcome and `find*` would
// promise an array it does not return.
//
// `resolve*` and `read*` are deliberately NOT here. They read both ways -
// `resolveOriginFromSpan` derives, `resolveProjectId` looks up - and 103
// findings sit on them, so a blanket exemption would bless the lookups along
// with the derivations. Each is decided at its own call site.
const DERIVATION_VOCABULARY =
  /^(parse|extract|build|stringify|serialize|serialise|deserialize|deserialise|format|render|normalize|normalise|coerce|decode|encode|convert|derive|compute|translate|project|visit|as|to|infer|classify|detect|pick|describe|map)([A-Z]|$)/;

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

/**
 * Whether the declared result is an array, looking through `Promise<...>`.
 * `find*` is the name for an array, so a `get*` answering one is still the
 * wrong prefix however non-nullable it is.
 */
function containsArrayType(node) {
  if (!node) return false;
  if (node.type === "TSArrayType") return true;
  if (node.type === "TSParenthesizedType") return containsArrayType(node.typeAnnotation);
  if (node.type === "TSTypeReference") {
    const name = node.typeName?.type === "Identifier" ? node.typeName.name : undefined;
    if (name === "Array" || name === "ReadonlyArray") return true;
  }
  const promiseArgument = promiseTypeArgument(node);
  if (promiseArgument) return containsArrayType(promiseArgument);
  return false;
}

/**
 * The one-or-throw shape, which is what `get` means and what belongs here. A
 * nullable result is `find*` wearing the wrong prefix, an array is `find*`
 * whatever precedes it, and no stated result type is `noResultType`'s case.
 */
function isOneOrThrowGet(name, returnType) {
  if (!GET_VOCABULARY.test(name)) return false;
  if (!returnType) return false;
  return !containsNullableType(returnType) && !containsArrayType(returnType);
}

export function isFallibleResultModule(file) {
  if (file.role !== "contract" && file.role !== "process") return false;
  if (!file.relative?.startsWith("src/")) return false;
  return FALLIBLE_RESULT_MODULE.test(file.relative);
}

export function withoutPrefix(name, prefix) {
  const rest = name.slice(prefix.length);
  return rest.charAt(0).toLowerCase() + rest.slice(1);
}

/** `getById` -> `ById` (so `find{{rest}}` reads `findById`); a bare `get`/`list` -> `All`. */
export function repositoryVocabularyRest(name) {
  if (name === "get" || name === "list") return "All";
  return name.startsWith("get") ? name.slice("get".length) : name.slice("list".length);
}

function isFindPrefixed(name) {
  return /^find[A-Z]?/.test(name);
}

// A try-prefixed name's rename belongs to `no-try-prefix`, and a repository
// get*/list* name's rename belongs to `repositoryServiceVocabulary` — both
// already prescribe the exact fix this message would otherwise restate.
function shouldReportNullableWithoutFind(name, returnType, isRepositoryVocabularyName) {
  if (!containsNullableType(returnType)) return false;
  if (isFindPrefixed(name)) return false;
  if (isTryPrefixedName(name)) return false;
  if (isRepositoryVocabularyName) return false;
  if (DERIVATION_VOCABULARY.test(name)) return false;
  return true;
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
      what: "`{{name}}` answers null or undefined, which is not a shape new code writes.",
      why: "A caller cannot tell whether absence here is an ordinary answer or a failure.",
      fix:
        "Decide what the absence means. If it is one thing that may not exist, name it"
        + " `get<Noun>` — or `getBy<Key>` when the key is what distinguishes it — and"
        + " throw the domain error, dropping null and undefined from the return type, so"
        + " the caller gets the answer or the reason there is none. If it is really none"
        + " or many, return an array and name it `find<Noun>`: the empty array is the"
        + " absence. If it is a write whose target may normally be absent, return an"
        + " explicit result union. Do not answer this by adding a nullable `find*` —"
        + " `find` states cardinality, and the existing nullable ones are left as they"
        + " are rather than joined by new ones.",
    },
    repositoryServiceVocabulary: {
      what: "Repository method `{{name}}` uses service vocabulary; repositories answer `find*`, services answer `get*`.",
      fix: "Rename it `find{{rest}}` here and in the repository interface this class implements.",
    },
  },
  create(context, file) {
    const isRepositoryVocabularyFile = REPOSITORY_METHOD_FILE.test(file.workspacePath ?? "");

    const check = (
      key,
      returnType,
      accessibility,
      { allowRepositoryVocabulary = false, isSwallow = false, typeStatedElsewhere = false } = {},
    ) => {
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

      const isRepositoryVocabularyName =
        allowRepositoryVocabulary
        && isRepositoryVocabularyFile
        && REPOSITORY_SERVICE_VOCABULARY.test(name)
        && !isOneOrThrowGet(name, returnType);
      if (isRepositoryVocabularyName) {
        context.report({
          node: key,
          messageId: "repositoryServiceVocabulary",
          data: { name, rest: repositoryVocabularyRest(name) },
        });
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

      if (shouldReportNullableWithoutFind(name, returnType, isRepositoryVocabularyName)) {
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
        allowRepositoryVocabulary: true,
        isSwallow: isSwallowCandidate(node.key) && bodyIsSwallow(body),
        typeStatedElsewhere: implementsInterface(node),
      });
    };

    return {
      MethodDefinition: checkMethod,
      TSAbstractMethodDefinition: checkMethod,
      TSMethodSignature(node) {
        if (node.computed) return;
        check(node.key, node.returnType?.typeAnnotation, undefined, { allowRepositoryVocabulary: true });
      },
      FunctionDeclaration(node) {
        check(node.id, node.returnType?.typeAnnotation, undefined, {
          isSwallow: isSwallowCandidate(node.id) && bodyIsSwallow(node.body),
        });
      },
    };
  },
});
