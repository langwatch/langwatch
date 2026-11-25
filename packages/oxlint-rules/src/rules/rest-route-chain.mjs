import { memberName } from "./zod-schema-origin.mjs";

// A REST route is one fluent chain opened by `get`/`post`/`put`/`patch`/`delete`
// (`RestTransportRouter`, packages/api/src/rest/declaration.ts) and closed by `.handle(...)`.

const ROUTE_OPENERS = new Set(["get", "post", "put", "patch", "delete"]);

/**
 * Walks a `.handle(...)` call down through its own `.object` chain until it
 * reaches the route-opening call, collecting every member name in between.
 * Returns `undefined` when the chain never reaches an opener.
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
