import { walk } from "../ast.mjs";
import { defineRule } from "../define-rule.mjs";
import { routeChainOf } from "./rest-route-chain.mjs";
import { familyOf, isPublishedRoute } from "./rest-route-published.mjs";
import { memberName, unwrap } from "./zod-schema-origin.mjs";

// dev/docs/ARCHITECTURE.md §8: one complete endpoint per route, withInput/withOutput
// mandatory, a handler returns a plain value or throws, wire schemas from the own contract.

const ANSWER_CALLS = new Set(["withOutput", "responds", "withResponse"]);
const INPUT_CALLS = new Set(["withInput", "withRawBody", "withMultipart"]);
const BODY_METHODS = new Set(["post", "put", "patch"]);
const SCHEMA_CALLS = new Set([
  "withParams",
  "withQuery",
  "withInput",
  "withMultipart",
  "withHeaders",
  "withOutput",
  "responds",
]);
const HANDLER_TYPES = new Set(["ArrowFunctionExpression", "FunctionExpression"]);
const CONTEXT_NAMES = new Set(["c", "ctx", "context"]);
const CONTEXT_WRITERS = new Set(["text", "body", "html", "redirect"]);
const ANSWER_HELPERS = new Set(["jsonAnswer", "jsonResponse", "rateLimitedResponse"]);
const ANSWER_CLASSES = new Set(["Response", "HTTPException"]);
const REFUSING_STATUS = /^[45]\d\d$/;
const CONTRACT_SOURCE = /^@langwatch\/(enterprise-)?([a-z0-9]+(?:-[a-z0-9]+)*)-contract(?:\/.*)?$/;
const BARE_PARAMS = new Map([
  ["id", "Id"],
  ["slug", "Slug"],
  ["name", "Name"],
  ["key", "Key"],
]);
const PARAM_CONSTRAINT = /\{.*$/;
const KEBAB_BOUNDARY = /-([a-z])/g;

function isRestTransport(file) {
  return (
    file.isProduction && file.role === "process" && (file.sourcePath ?? "").endsWith(".rest.ts")
  );
}

function stringLiteral(node) {
  return node?.type === "Literal" && typeof node.value === "string" ? node.value : void 0;
}

function operationOf(chain) {
  const path = stringLiteral(chain.opener.arguments[0]) ?? "<path>";

  return `${chain.opens.toUpperCase()} ${path}`;
}

function constInitOf(context, node) {
  const value = unwrap(node);
  if (value?.type !== "Identifier") return value;
  const definition = variableDefinition(context, value);

  return definition?.type === "Variable" && definition.parent?.kind === "const"
    ? unwrap(definition.node.init)
    : void 0;
}

function isPublicRoute(context, call) {
  if (call.name !== "withAccess") return false;
  const access = constInitOf(context, call.node.arguments[0]);
  if (access?.type !== "CallExpression") return false;

  const callee = access.callee;
  return (callee.type === "Identifier" ? callee.name : memberName(callee)) === "publicRoute";
}

function isContextReceiver(node) {
  if (node.type === "Identifier") return CONTEXT_NAMES.has(node.name);

  return node.type === "MemberExpression" && CONTEXT_NAMES.has(memberName(node));
}

function receiverText(node) {
  if (node.type === "Identifier") return node.name;
  if (node.type === "MemberExpression") return `${receiverText(node.object)}.${memberName(node)}`;

  return "(...)";
}

function writerSymbol(call) {
  const callee = call.callee;
  if (callee.type === "Identifier") {
    return ANSWER_HELPERS.has(callee.name) ? `${callee.name}(...)` : void 0;
  }
  if (callee.type !== "MemberExpression" || call.arguments.length === 0) return void 0;

  const name = memberName(callee);
  const writes =
    (name === "json" && receiverText(callee.object) !== "JSON") ||
    (CONTEXT_WRITERS.has(name) && isContextReceiver(callee.object));

  return writes ? `${receiverText(callee.object)}.${name}(...)` : void 0;
}

function variableDefinition(context, identifier) {
  let scope = context.sourceCode.getScope(identifier);
  while (scope && !scope.set.has(identifier.name)) scope = scope.upper;

  return scope?.set.get(identifier.name)?.defs[0];
}

function isRefusingStatus(context, node) {
  const value = constInitOf(context, node);

  return value?.type === "Literal" && REFUSING_STATUS.test(String(value.value));
}

function refusingStatusOf(context, object) {
  if (object?.type !== "ObjectExpression") return void 0;
  const status = object.properties.find(
    (property) =>
      property.type === "Property" && !property.computed && property.key.name === "status",
  );

  return status && isRefusingStatus(context, status.value) ? unwrap(status.value) : void 0;
}

function constructedAnswer(node) {
  if (node.type !== "NewExpression" || !ANSWER_CLASSES.has(node.callee.name)) return void 0;

  return `new ${node.callee.name}(...)`;
}

function refusalAnswer(context, object) {
  const status = refusingStatusOf(context, object);

  return status ? { node: object, symbol: `{ status: ${status.name ?? status.value} }` } : void 0;
}

/** Where and with what a handler node builds its own answer, or undefined. */
function manualAnswerOf(context, node, declaresStatuses) {
  const symbol = node.type === "CallExpression" ? writerSymbol(node) : constructedAnswer(node);
  if (symbol) return { node, symbol };
  if (declaresStatuses || node.type !== "ReturnStatement") return void 0;

  return refusalAnswer(context, node.argument);
}

function handlerAnswers(context, handler, declaresStatuses) {
  const found = [];
  if (handler.expression && !declaresStatuses) found.push(refusalAnswer(context, handler.body));
  walk(handler.body, (node) => {
    found.push(manualAnswerOf(context, node, declaresStatuses));
  });

  return found.filter(Boolean);
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

function bareParamsOf(path, namespace) {
  const found = [];
  let owner = namespace;

  for (const segment of path.split("/").filter(Boolean)) {
    if (!segment.startsWith(":")) {
      owner = segment;
      continue;
    }

    const name = segment.slice(1).replace(PARAM_CONSTRAINT, "");
    const suffix = BARE_PARAMS.get(name);
    if (suffix)
      found.push({ name, suggestion: `${owner ? entityOf(owner) : "<entity>"}${suffix}` });
  }

  return found;
}

function importSourceOf(context, identifier) {
  const definition = variableDefinition(context, identifier);

  return definition?.type === "ImportBinding" ? definition.parent.source.value : void 0;
}

function isValueIdentifier(node) {
  if (node.type !== "Identifier") return false;
  const parent = node.parent;
  if (parent?.type === "MemberExpression" && parent.property === node && !parent.computed) {
    return false;
  }

  return !(parent?.type === "Property" && parent.key === node && !parent.computed);
}

function isForeignContract(source, file) {
  const match = CONTRACT_SOURCE.exec(source ?? "");
  if (!match) return false;

  return Boolean(match[1]) !== Boolean(file.enterprise) || match[2] !== file.feature;
}

function foreignSchemasOf(context, file, chain) {
  const found = [];

  for (const call of chain.calls.filter((entry) => SCHEMA_CALLS.has(entry.name))) {
    for (const argument of call.node.arguments) {
      walk(argument, (node) => {
        if (HANDLER_TYPES.has(node.type)) return false;
        if (!isValueIdentifier(node)) return;
        const source = importSourceOf(context, node);
        if (isForeignContract(source, file)) found.push({ node, source });
      });
    }
  }

  return found;
}

function declarationDefects(context, chain) {
  const names = new Set(chain.calls.map((call) => call.name));
  const isPublic = chain.calls.some((call) => isPublicRoute(context, call));
  const defects = [];

  if (!isPublic && ![...ANSWER_CALLS].some((name) => names.has(name)))
    defects.push("missingOutput");

  const needsInput = BODY_METHODS.has(chain.opens) && !isPublic && !names.has("withResponse");
  if (needsInput && ![...INPUT_CALLS].some((name) => names.has(name))) defects.push("missingInput");

  return defects;
}

/** A bare parameter main already publishes keeps its name; a new route names it. */
function pathParamFindings(context, chain) {
  const node = chain.opener.arguments[0];
  const path = stringLiteral(node) ?? "";
  const family = familyOf(chain.opener);
  const bare = bareParamsOf(path, family.namespace);
  if (bare.length === 0) return [];
  const successor = stringLiteral(constInitOf(context, family.successor));
  if (isPublishedRoute({ cwd: context.cwd, method: chain.opens, path, family, successor }))
    return [];

  return bare.map((data) => ({ node, messageId: "pathParam", data }));
}

/** What the route's path and schemas get wrong, each on the node that writes it. */
function wireFindings(context, file, chain) {
  const params = pathParamFindings(context, chain);
  const schemas = foreignSchemasOf(context, file, chain).map(({ node, source }) => ({
    node,
    messageId: "foreignContract",
    data: { name: node.name, source },
  }));

  return [...params, ...schemas];
}

/** A raw hatch is the one answer finding; otherwise the declarations, then the handler. */
function answerFindings(context, handle, chain) {
  const raw = chain.calls.find((call) => call.name === "withRawResponse");
  if (raw) return [{ node: raw.node.callee.property, messageId: "rawResponse" }];

  const declared = declarationDefects(context, chain).map((messageId) => ({
    node: chain.opener.callee.property,
    messageId,
  }));
  const handler = handle.arguments[0];
  if (!handler || !HANDLER_TYPES.has(handler.type)) return declared;

  const declaresStatuses = chain.calls.some((call) => call.name === "responds");
  const built = handlerAnswers(context, handler, declaresStatuses).map(({ node, symbol }) => ({
    node,
    messageId: "manualAnswer",
    data: { symbol },
  }));

  return [...declared, ...built];
}

export const restRouteRule = defineRule({
  name: "rest-route",
  kind: "problem",
  applies: isRestTransport,
  messages: {
    missingOutput: {
      what: "REST route `{{operation}}` declares no answer.",
      why: "the framework serialises and documents only what the route declares (ARCHITECTURE.md §8).",
      fix: "Add `.withOutput(<schema>)` from the module's own contract (`z.void()` for a route that answers with nothing), `.responds({...})` for several statuses, or `.withResponse(<kind>)` for a non-JSON answer.",
    },
    missingInput: {
      what: "REST route `{{operation}}` is a body-carrying method but declares no input.",
      why: "input is mandatory on every route, and the framework parses and validates only what the route declares (ARCHITECTURE.md §8).",
      fix: "Add `.withInput(<schema>)` from the module's own contract; an action that takes no body declares an empty input schema there. A body nothing should parse uses `.withRawBody(...)` or `.withMultipart(...)` instead.",
    },
    rawResponse: {
      what: "REST route `{{operation}}` answers through `.withRawResponse`, the retired hatch.",
      why: "a non-JSON protocol declares the kind it answers with, and the handler is handed the one producer for that kind (ARCHITECTURE.md §8).",
      fix: 'Replace it with `.withResponse("bytes" | "sse" | "redirect" | "protocol" | "forwarded", {...})` and produce the answer through the handler\'s `response` argument; a JSON answer declares `.withOutput(<schema>)` and returns a plain value.',
    },
    manualAnswer: {
      what: "The handler for `{{operation}}` builds its own answer with `{{symbol}}`.",
      why: "a hand-built answer skips the framework's serialisation, and a hand-built refusal carries no code for the client to key on.",
      fix: "Return the plain value the declared output describes, and throw a HandledError with a stable code for a refusal (a plain Error for anything else).",
    },
    pathParam: {
      what: "REST route `{{operation}}` takes a path parameter named `{{name}}`.",
      why: "the parameter name is published in the OpenAPI document and becomes the argument name in every generated client.",
      fix: "Name it for what it identifies - `:{{suggestion}}` - and rename the matching field in the route's withParams() schema.",
    },
    foreignContract: {
      what: "REST route `{{operation}}` declares its wire with `{{name}}` from `{{source}}`, another module's contract.",
      why: "every wire schema imports from the module's own contract (ARCHITECTURE.md §8).",
      fix: "Declare the shape in this module's own contract and import it from there, or move the route to the module that owns `{{source}}`.",
    },
  },
  create(context, file) {
    return {
      CallExpression(node) {
        if (node.callee.type !== "MemberExpression" || memberName(node.callee) !== "handle") return;

        const chain = routeChainOf(node);
        if (!chain) return;

        const operation = operationOf(chain);
        for (const finding of [
          ...wireFindings(context, file, chain),
          ...answerFindings(context, node, chain),
        ]) {
          context.report({ ...finding, data: { operation, ...finding.data } });
        }
      },
    };
  },
});
