import { defineRule } from "../define-rule.mjs";

// The framework owns request validation (api-framework-bypass plan, guard 3).
// A raw body is for bytes that are not JSON, and states why (W-02 G3a, Alex 2026-10-08).

const NAMES_JSON = /json/i;

function isJsonParse(callee) {
  return (
    callee?.type === "MemberExpression" &&
    callee.object?.name === "JSON" &&
    callee.property?.name === "parse"
  );
}

function optionOf(options, name) {
  if (options?.type !== "ObjectExpression") return undefined;
  return options.properties.find((property) => property.key?.name === name)?.value;
}

function isBlankText(value) {
  return value?.type === "Literal" && typeof value.value === "string" && value.value.trim() === "";
}

// shortcut: a constant is judged by its name (PRODUCES_JSON); read its value once rules get types.
function namesJson(value) {
  if (value?.type === "Literal")
    return typeof value.value === "string" && NAMES_JSON.test(value.value);
  if (value?.type === "TemplateLiteral")
    return value.quasis.some((quasi) => NAMES_JSON.test(quasi.value.cooked ?? ""));
  if (value?.type === "Identifier") return NAMES_JSON.test(value.name);
  if (value?.type === "MemberExpression") return NAMES_JSON.test(value.property?.name ?? "");
  return false;
}

export const rawBodyBypassRule = defineRule({
  name: "raw-body-bypass",
  kind: "problem",
  applies: (file) => file.isProduction && Boolean(file.feature),
  escape: { framework: "`@langwatch/api`'s body declarations (`.withInput`, `.withRawBody`)" },
  messages: {
    rawBodyBecause: {
      what: "`.withRawBody(...)` in `{{path}}` gives no `because`.",
      why: "A raw body skips the framework's validation, so each one states why the bytes are needed.",
      fix: 'Pass `{ because: "<why this route needs the exact body>" }` in `.withRawBody`\'s options. Read the `api-transports` skill.',
    },
    rawBodyMediaType: {
      what: "`.withRawBody(...)` in `{{path}}` names no non-JSON `mediaType`.",
      why: "Only a body that is not JSON needs its exact bytes; a JSON body is the framework's to parse and validate.",
      fix: "Declare a JSON body with `.withInput(schema)`, or pass the non-JSON `mediaType` the route reads. Read the `api-transports` skill.",
    },
    jsonParse: {
      what: "`JSON.parse` in the transport `{{path}}`.",
      why: "Parsing a body by hand skips the framework's validation and its 400 and 422 answers.",
      fix: "Declare the body with `.withInput(schema)` and read `input` in the handler. Read the `api-transports` skill.",
    },
  },
  create(context, file) {
    const path = file.workspacePath;
    const inTransport = file.role === "process" && file.sourcePath?.startsWith("transport/");

    return {
      CallExpression(node) {
        const { callee } = node;
        if (inTransport && isJsonParse(callee)) {
          context.report({ node, messageId: "jsonParse", data: { path } });
          return;
        }
        if (callee?.type !== "MemberExpression" || callee.property?.name !== "withRawBody") return;
        const options = node.arguments[1];
        const mediaType = optionOf(options, "mediaType");
        if (mediaType === undefined || namesJson(mediaType)) {
          context.report({ node: callee.property, messageId: "rawBodyMediaType", data: { path } });
        }
        const because = optionOf(options, "because");
        if (because === undefined || isBlankText(because)) {
          context.report({ node: callee.property, messageId: "rawBodyBecause", data: { path } });
        }
      },
    };
  },
});
