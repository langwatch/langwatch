import { defineRule } from "../define-rule.mjs";

// A service decides; it does not speak a wire protocol. Reported: imports of HTTP modules or raw
// exchange types, Fetch `Response` built in a service, and writes on a response object. Response
// detection is by name and annotation only, so it leans to false negatives.
// See dev/docs/adr/192-platform-blocks-architecture-drift.md.

const HTTP_MODULE = /^(?:node:)?https?$|^(?:node:)?http2$/;
const WIRE_TYPES = new Set(["IncomingMessage", "ServerResponse"]);
const RESPONSE_TYPES = new Set([
  "ServerResponse",
  "OutgoingMessage",
  "Http2ServerResponse",
  "Response",
]);
const RESPONSE_NAME = /^(?:res|resp|response|reply)$|[a-z0-9](?:Response|Res)$/;
const RESPONSE_FACTORIES = new Set(["json", "redirect", "error"]);
const RESPONSE_WRITES = new Set(["setHeader", "end", "write"]);

function importedName(specifier) {
  if (specifier.type !== "ImportSpecifier") return undefined;

  return specifier.imported?.name ?? specifier.imported?.value;
}

/** The first thing an import names that belongs to the wire, or undefined. */
function wireNameOf(node) {
  const source = node.source?.value;
  if (typeof source === "string" && HTTP_MODULE.test(source)) return source;

  return (node.specifiers ?? []).map(importedName).find((name) => WIRE_TYPES.has(name));
}

/** The name a receiver goes by: `res` for `res`, and for `ctx.res`, or undefined. */
function receiverName(node) {
  if (node?.type === "Identifier") return node.name;
  if (node?.type === "MemberExpression" && !node.computed) return node.property?.name;

  return undefined;
}

/** The type name an annotation references, through `T | undefined` unions. */
function annotatedTypeNames(annotation) {
  const type = annotation?.typeAnnotation;
  if (type?.type === "TSTypeReference" && type.typeName?.type === "Identifier") {
    return [type.typeName.name];
  }
  if (type?.type === "TSUnionType") {
    return type.types.flatMap((member) => annotatedTypeNames({ typeAnnotation: member }));
  }

  return [];
}

function importsLocalResponse(node) {
  return (node.specifiers ?? []).some((specifier) => specifier.local?.name === "Response");
}

function isResponse(node, state) {
  const name = receiverName(node);
  if (name === undefined) return false;
  if (node.type === "Identifier" && state.responseBindings.has(name)) return true;

  return RESPONSE_NAME.test(name);
}

/** The report a call makes, `{ messageId, shape }`, or undefined if none. */
function responseCallShape({ node, state }) {
  const callee = node.callee;
  if (callee?.type !== "MemberExpression" || callee.computed) return undefined;
  const method = callee.property?.name;
  if (method === "writeHead") return { messageId: "writesTheResponse", shape: ".writeHead(" };
  if (RESPONSE_WRITES.has(method) && isResponse(callee.object, state)) {
    return { messageId: "writesTheResponse", shape: `.${method}(` };
  }
  const isFetchResponse = callee.object?.type === "Identifier" && callee.object.name === "Response";
  if (!state.responseIsLocal && RESPONSE_FACTORIES.has(method) && isFetchResponse) {
    return { messageId: "buildsTheResponse", shape: `Response.${method}(` };
  }

  return undefined;
}

function recordResponseBinding({ node, state }) {
  const typeNames = annotatedTypeNames(node.typeAnnotation);
  if (typeNames.some((name) => RESPONSE_TYPES.has(name))) state.responseBindings.add(node.name);
}

function isFetchResponseConstruction({ node, state }) {
  const isResponseCallee = node.callee?.type === "Identifier" && node.callee.name === "Response";

  return !state.responseIsLocal && isResponseCallee;
}

function isStatusCodeWrite({ node, state }) {
  const target = node.left;
  if (target?.type !== "MemberExpression" || target.computed) return false;

  return target.property?.name === "statusCode" && isResponse(target.object, state);
}

export const noTransportInServiceRule = defineRule({
  name: "no-transport-in-service",
  kind: "problem",
  applies: (file) => file.role === "process" && file.layer === "services" && file.isProduction,
  messages: {
    transportInService: {
      what: "A service names `{{name}}`, a piece of the HTTP wire.",
      why: "A decision tied to a raw request or response cannot be tested without a socket or reused by another transport.",
      fix: "Take plain values (a bearer, a body, an address) and answer plain values or a result union; the transport that received the exchange reads the request and writes the response. Read the `api-transports` skill.",
    },
    writesTheResponse: {
      what: "A service writes the HTTP response itself (`{{shape}}`).",
      why: "Status, headers and body are the transport's to write; a service that writes them owns a protocol it cannot name.",
      fix: "Return the status and body as data, or throw the module's HandledError, and let the transport write the response. Read the `api-transports` skill.",
    },
    buildsTheResponse: {
      what: "A service builds a Fetch `Response` (`{{shape}}`).",
      why: "A built response fixes status, headers and encoding inside the decision; no other transport can reuse it.",
      fix: "Return a discriminated answer (its kind, status, body and headers as data) and let a door in the module's transport/ folder build the Response. Read the `api-transports` skill.",
    },
  },
  create(context) {
    const state = { responseIsLocal: false, responseBindings: new Set() };
    const report = (node, messageId, data) => context.report({ node, messageId, data });

    return {
      ImportDeclaration(node) {
        const name = wireNameOf(node);
        if (name) report(node, "transportInService", { name });
        if (importsLocalResponse(node)) state.responseIsLocal = true;
      },
      Identifier: (node) => recordResponseBinding({ node, state }),
      NewExpression(node) {
        if (isFetchResponseConstruction({ node, state })) {
          report(node, "buildsTheResponse", { shape: "new Response(" });
        }
      },
      AssignmentExpression(node) {
        if (isStatusCodeWrite({ node, state })) {
          report(node, "writesTheResponse", { shape: ".statusCode =" });
        }
      },
      CallExpression(node) {
        const found = responseCallShape({ node, state });
        if (found) report(node, found.messageId, { shape: found.shape });
      },
    };
  },
});
