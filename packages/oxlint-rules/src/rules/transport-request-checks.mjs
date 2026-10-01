import { walk } from "../ast.mjs";
import { propertyName } from "./transport-handlers.mjs";

// A route declares its media type and its schema, and the framework refuses a
// request that does not match them (ARCHITECTURE.md §8). What
// `transport-declares` reads when a transport or a middleware binding
// re-checks either by hand.

const CONTENT_TYPE = "content-type";
const MATCHERS = new Set(["includes", "startsWith", "endsWith", "match"]);
const NORMALISERS = new Set(["toLowerCase", "toLocaleLowerCase", "trim"]);
const COMPARISONS = new Set(["===", "!==", "==", "!="]);
const WRAPPERS = new Set(["ChainExpression", "TSNonNullExpression"]);
const FALLBACKS = new Set(["??", "||"]);
const BODY_READERS = new Set(["json", "text", "parseBody", "formData", "arrayBuffer", "blob"]);
const SCOPES = new Set([
  "ArrowFunctionExpression",
  "FunctionDeclaration",
  "FunctionExpression",
  "Program",
]);

function lastName(node) {
  return node?.type === "Identifier" ? node.name : propertyName(node);
}

function isContentTypeKey(node) {
  return typeof node?.value === "string" && node.value.toLowerCase() === CONTENT_TYPE;
}

/**
 * `c.req.header("content-type")`, `request.headers.get("content-type")`,
 * `headers["content-type"]`.
 */
function isContentTypeRead(node) {
  if (node.type === "MemberExpression") {
    return node.computed && isContentTypeKey(node.property) && lastName(node.object) === "headers";
  }
  if (node.type !== "CallExpression") return false;
  const reader = propertyName(node.callee);
  const onHeaders =
    reader === "header" || (reader === "get" && lastName(node.callee.object) === "headers");

  return onHeaders && isContentTypeKey(node.arguments[0]);
}

function isCalledMember(member, object) {
  const call = member.parent;

  return member.object === object && call?.type === "CallExpression" && call.callee === member;
}

/** The expression that consumes `node`, past `?.`, `!` and `.toLowerCase()`. */
function consumed(node) {
  const { parent } = node;
  if (WRAPPERS.has(parent?.type)) return consumed(parent);
  const normalised =
    parent?.type === "MemberExpression" &&
    NORMALISERS.has(propertyName(parent)) &&
    isCalledMember(parent, node);

  return normalised ? consumed(parent.parent) : node;
}

/** The value decides something: it is compared, matched or tested against a pattern. */
function isCompared(node) {
  const value = consumed(node);
  const { parent } = value;
  if (parent?.type === "BinaryExpression") return COMPARISONS.has(parent.operator);
  if (parent?.type === "CallExpression") {
    return propertyName(parent.callee) === "test" && parent.arguments.includes(value);
  }
  const matched = parent?.type === "MemberExpression" && MATCHERS.has(propertyName(parent));

  return matched && isCalledMember(parent, value);
}

/** `const contentType = request.headers.get("content-type") ?? ""` binds a read. */
function aliasedRead(declarator) {
  let init = declarator.init;
  if (WRAPPERS.has(init?.type)) init = init.expression;
  if (init?.type === "LogicalExpression" && FALLBACKS.has(init.operator)) init = init.left;
  const named = declarator.id.type === "Identifier" && init !== undefined && init !== null;

  return named && isContentTypeRead(init) ? declarator.id.name : undefined;
}

function enclosingScope(node) {
  return SCOPES.has(node.parent?.type) ? node.parent : enclosingScope(node.parent);
}

function reportComparedAlias({ declarator, name, tools }) {
  walk(enclosingScope(declarator), (node) => {
    const reference = node.type === "Identifier" && node.name === name && node !== declarator.id;
    if (reference && isCompared(node)) {
      tools.report(node, "mediaTypeCheck", { text: tools.text(declarator.init) });
    }
  });
}

function isRequestBodyRead(node) {
  const reader = node.type === "CallExpression" ? propertyName(node.callee) : undefined;

  return BODY_READERS.has(reader) && lastName(node.callee.object) === "req";
}

/** A transport or `*.server.ts` source that reads the request's media type or body to decide
 * on it. */
export function reportRequestRechecks(program, tools) {
  walk(program, (node) => {
    if (isRequestBodyRead(node)) tools.report(node, "requestBodyRead", { text: tools.text(node) });
    if (isContentTypeRead(node) && isCompared(node)) {
      tools.report(node, "mediaTypeCheck", { text: tools.text(node) });
    }
    const name = node.type === "VariableDeclarator" ? aliasedRead(node) : undefined;
    if (name) reportComparedAlias({ declarator: node, name, tools });
  });
}
