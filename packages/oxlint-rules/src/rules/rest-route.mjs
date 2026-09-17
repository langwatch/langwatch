import { memberName } from "./zod-schema-origin.mjs";

// Every REST route is one fluent chain opened by a method call and closed by
// `.handle(...)` (verified against `packages/api/src/rest/declaration.ts`,
// `RestTransportRouter`: `get`/`post`/`put`/`patch`/`delete` are the only
// openers it exposes). `rest-declares-input-output` and `rest-handler-throws`
// both need to walk that one chain, so the walk lives here once.

export const ROUTE_OPENERS = new Set(["get", "post", "put", "patch", "delete"]);
/** `get`/`head` cannot carry a body (`assertBodyMethod`); `head` has no opener. */
export const BODY_BEARING_OPENERS = new Set(["post", "put", "patch", "delete"]);

/**
 * Walks a `.handle(...)` call down through its own `.object` chain until it
 * reaches the route-opening call, collecting every member name in between.
 * Returns `undefined` when the chain never reaches an opener - the call is not
 * one of this framework's routes.
 */
export function routeChainOf(handleCall) {
  const calls = [];
  let current = handleCall;

  while (current?.type === "CallExpression" && current.callee.type === "MemberExpression") {
    const name = memberName(current.callee);
    calls.push({ name, node: current });
    if (ROUTE_OPENERS.has(name)) return { opener: current, opens: name, calls };
    current = current.callee.object;
  }

  return undefined;
}

function calleeName(node) {
  if (node?.type !== "CallExpression") return undefined;
  return node.callee.type === "Identifier" ? node.callee.name : memberName(node.callee);
}

/** A route escaped through the one non-JSON door this law still allows. */
export function isEscapedRoute(calls) {
  return calls.some(
    (call) =>
      call.name === "withRawResponse" ||
      (call.name === "withAccess" && calleeName(call.node.arguments[0]) === "publicRoute"),
  );
}

/** The route's own operation name: every opener's second argument names it. */
export function operationNameOf(opener) {
  const argument = opener.arguments[1];
  return argument?.type === "Literal" && typeof argument.value === "string"
    ? argument.value
    : "route";
}
