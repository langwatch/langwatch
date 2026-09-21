import { defineRule } from "../define-rule.mjs";
import { ROUTE_OPENERS, operationNameOf } from "./rest-route.mjs";
import { memberName } from "./zod-schema-origin.mjs";

// A path parameter is published: it is the parameter name in the OpenAPI
// document and the argument name in every generated client. `:id` tells a
// reader nothing about what it identifies, and the handler under it almost
// always renames the value to the entity anyway (`teamId: input.id`).

const BARE_PARAMS = new Map([
  ["id", "Id"],
  ["slug", "Slug"],
  ["name", "Name"],
  ["key", "Key"],
]);
const PARAM_CONSTRAINT = /\{.*$/;
const KEBAB_BOUNDARY = /-([a-z])/g;

function isRestTransport(file) {
  return file.isProduction && file.role === "process" && (file.sourcePath ?? "").endsWith(".rest.ts");
}

/** `virtual-keys` -> `virtualKey`, so the suggestion reads as the entity. */
function entityOf(segment) {
  const camel = segment.replace(KEBAB_BOUNDARY, (_, letter) => letter.toUpperCase());
  const lower = camel.charAt(0).toLowerCase() + camel.slice(1);

  if (lower.endsWith("ies")) return `${lower.slice(0, -3)}y`;
  if (lower.endsWith("sses")) return lower.slice(0, -2);
  if (lower.endsWith("s") && !lower.endsWith("ss")) return lower.slice(0, -1);

  return lower;
}

/**
 * The collection the router addresses, off its own `.withNamespace(...)`.
 * A route opened at the namespace root (`/:id`) names no entity in its path,
 * so the namespace is the only place the entity is written down.
 */
function namespaceOf(opener) {
  let current = opener.callee.object;

  while (current?.type === "CallExpression" && current.callee.type === "MemberExpression") {
    if (memberName(current.callee) === "withNamespace") {
      const argument = current.arguments[0];
      return argument?.type === "Literal" && typeof argument.value === "string"
        ? argument.value
        : undefined;
    }
    current = current.callee.object;
  }

  return undefined;
}

/** Every bare parameter in one route path, each with the entity that owns it. */
function bareParamsOf(path, namespace) {
  const found = [];
  let owner = namespace;

  for (const segment of path.split("/")) {
    if (!segment) continue;

    if (!segment.startsWith(":")) {
      owner = segment;
      continue;
    }

    const name = segment.slice(1).replace(PARAM_CONSTRAINT, "");
    const suffix = BARE_PARAMS.get(name);

    if (suffix) {
      found.push({ name, suggestion: owner ? `${entityOf(owner)}${suffix}` : `<entity>${suffix}` });
    }
  }

  return found;
}

export const restPathParamIsSemanticRule = defineRule({
  name: "rest-path-param-is-semantic",
  kind: "problem",
  applies: isRestTransport,
  messages: {
    barePathParam: {
      what: "REST `{{operation}}` takes a path parameter named `{{name}}`.",
      fix: "Name it for what it identifies - `:{{suggestion}}` - and rename the matching field in the route's withParams() schema.",
      why: "the parameter name is published in the OpenAPI document and becomes the argument name in every generated client.",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        if (node.callee.type !== "MemberExpression") return;
        if (!ROUTE_OPENERS.has(memberName(node.callee))) return;

        const path = node.arguments[0];
        if (path?.type !== "Literal" || typeof path.value !== "string") return;

        const operation = operationNameOf(node);

        for (const { name, suggestion } of bareParamsOf(path.value, namespaceOf(node))) {
          context.report({
            node: path,
            messageId: "barePathParam",
            data: { operation, name, suggestion },
          });
        }
      },
    };
  },
});
