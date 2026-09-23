import { walk } from "../ast.mjs";
import { defineRule } from "../define-rule.mjs";
import {
  isFallibleResultModule,
  isTryPrefixedName,
  withoutPrefix,
} from "./fallible-result-naming.rule.mjs";

// `try*` and `require*` name how a method behaves on failure, not what it
// answers (ADR-146). One finding per name: a `try*` whose own body swallows a
// failure is told about that catch, any other `try*` is not accused of one.

const FUNCTION_BOUNDARY = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
]);
const REQUIRE_PREFIX = /^require[A-Z]/;

const RENAME =
  "A lookup of one thing becomes `get<Noun>` — or `getBy<Key>` when the key is what distinguishes it —" +
  " and throws the domain error instead of answering null. None or many becomes `find<Noun>`" +
  " returning an array, whose empty case is the absence. A derivation (`parse`, `extract`," +
  " `derive` and the other ADR-146 derivation verbs) may answer undefined when its input carried none." +
  " Never rename it to a `find*` that still answers null — `find` promises a list.";

function isNullishExpression(node) {
  if (!node) return false;
  if (node.type === "Literal" && node.value === null) return true;
  if (node.type === "Identifier" && node.name === "undefined") return true;
  return node.type === "UnaryExpression" && node.operator === "void";
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
    return node === root || !FUNCTION_BOUNDARY.has(node.type);
  });
  return found;
}

const hasThrowInScope = (root) => scopedSearch(root, (node) => node.type === "ThrowStatement");
const hasNullishReturnInScope = (root) =>
  scopedSearch(
    root,
    (node) =>
      node.type === "ReturnStatement" &&
      (node.argument == null || isNullishExpression(node.argument)),
  );

function isSwallowingCatchClause(node) {
  if (hasThrowInScope(node.body)) return false;
  return node.body.body.length === 0 || hasNullishReturnInScope(node.body);
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
  if (handler?.type !== "ArrowFunctionExpression" && handler?.type !== "FunctionExpression")
    return false;
  if (handler.body.type !== "BlockStatement") return isNullishExpression(handler.body);
  return !hasThrowInScope(handler.body) && hasNullishReturnInScope(handler.body);
}

// "found" ends the walk with a match, "skip" prunes the subtree, "continue" descends.
function swallowClassification(node, root) {
  if (node.type === "CatchClause") return isSwallowingCatchClause(node) ? "found" : "skip";
  if (isCatchChainCall(node)) return isSwallowingCatchChain(node) ? "found" : "skip";
  if (node !== root && FUNCTION_BOUNDARY.has(node.type)) return "skip";
  return "continue";
}

/** Whether a body converts a caught error or a rejected promise into a nullish value. */
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

function isVoidType(type) {
  if (type?.type === "TSVoidKeyword") return true;
  if (type?.type === "TSTypePredicate") return type.asserts === true;
  if (type?.type !== "TSTypeReference" || type.typeName?.name !== "Promise") return false;
  const [argument] = (type.typeArguments ?? type.typeParameters)?.params ?? [];

  return argument?.type === "TSVoidKeyword";
}

/** Whether it answers nothing: declared void or asserts, or a body with no valued return. */
function answersNothing({ body, returnType }) {
  if (returnType) return isVoidType(returnType.typeAnnotation);
  if (body?.type !== "BlockStatement") return false;

  return !scopedSearch(body, (node) => node.type === "ReturnStatement" && node.argument != null);
}

function isModuleScopeDeclarator(node) {
  const owner = node.parent?.parent;
  return owner?.type === "Program" || owner?.type === "ExportNamedDeclaration";
}

function reportBannedPrefix(context, { accessibility, body, key, returnType }) {
  if (key?.type !== "Identifier" || accessibility === "private") return;
  const name = key.name;
  if (isTryPrefixedName(name)) {
    const messageId = bodyIsSwallow(body) ? "swallowingTry" : "tryPrefix";
    context.report({ node: key, messageId, data: { name } });
    return;
  }
  if (!REQUIRE_PREFIX.test(name)) return;
  const plain = withoutPrefix(name, "require");
  const rest = plain.charAt(0).toUpperCase() + plain.slice(1);
  const messageId = answersNothing({ body, returnType }) ? "requireAssertion" : "requirePrefix";
  context.report({ node: key, messageId, data: { name, rest } });
}

export const bannedVerbPrefixRule = defineRule({
  name: "banned-verb-prefix",
  kind: "problem",
  applies: isFallibleResultModule,
  messages: {
    tryPrefix: {
      what: "`{{name}}` is named for how it behaves on failure, not for what it answers.",
      why: "A caller reading the call site cannot tell a lookup from a hedge, and the two need different handling.",
      fix: `Drop \`try\` and name it for what it answers. ${RENAME}`,
    },
    swallowingTry: {
      what: "`{{name}}` hedges: its catch turns a failure into null or undefined, so the caller cannot tell absence from breakage.",
      fix: `Delete the catch that answers null or undefined so the failure reaches the caller, then drop \`try\` and name it for what it answers. ${RENAME}`,
    },
    requirePrefix: {
      what: "`{{name}}` carries a `require` prefix, which says how it fails rather than what it answers.",
      fix: "Name it `get{{rest}}` and leave the body as it is: ADR-146's `get` already answers exactly one thing or throws.",
    },
    requireAssertion: {
      what: "`{{name}}` carries a `require` prefix, which says how it fails rather than what it checks.",
      fix: "Name it `assert{{rest}}` and leave the body as it is: an `assert*` answers nothing and throws when the condition fails.",
    },
  },
  create(context) {
    const check = (declaration) => reportBannedPrefix(context, declaration);

    const checkMethod = (node) => {
      if (node.kind !== "method" || node.computed) return;
      check({
        accessibility: node.accessibility,
        body: node.value?.body,
        key: node.key,
        returnType: node.value?.returnType,
      });
    };

    return {
      MethodDefinition: checkMethod,
      TSAbstractMethodDefinition: checkMethod,
      TSMethodSignature(node) {
        if (!node.computed) check({ key: node.key, returnType: node.returnType });
      },
      FunctionDeclaration(node) {
        check({ body: node.body, key: node.id, returnType: node.returnType });
      },
      VariableDeclarator(node) {
        const init = node.init;
        if (init?.type !== "ArrowFunctionExpression" && init?.type !== "FunctionExpression") return;
        if (isModuleScopeDeclarator(node)) {
          check({ body: init.body, key: node.id, returnType: init.returnType });
        }
      },
    };
  },
});
