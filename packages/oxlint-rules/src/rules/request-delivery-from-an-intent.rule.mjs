import { defineRule } from "../define-rule.mjs";

// ADR-167 (Alex, 2026-10-06): a producer records a deliver intent in its own commit and its
// outbox calls a kind's requestDelivery after the commit. A call anywhere else either sends
// for a step that later rolls back, or loses the request when the process dies mid-step.

const OPERATION = "requestDelivery";
const EXECUTOR_TYPE = "IntentExecutor";
const FUNCTION_TYPES = new Set([
  "ArrowFunctionExpression",
  "FunctionExpression",
  "FunctionDeclaration",
]);

function propertyName(node) {
  if (!node) return undefined;
  if (node.type === "Identifier" || node.type === "PrivateIdentifier") return node.name;
  if (node.type === "Literal" || node.type === "StringLiteral") return node.value;

  return undefined;
}

function isRequestDeliveryCall(node) {
  const callee = node.callee;
  if (callee?.type !== "MemberExpression") return false;

  return callee.computed
    ? callee.property?.value === OPERATION
    : propertyName(callee.property) === OPERATION;
}

/** `IntentExecutor<...>` named by a type annotation, written either way TypeScript allows. */
function namesExecutor(annotation) {
  const type = annotation?.typeAnnotation ?? annotation;
  if (type?.type !== "TSTypeReference") return false;
  const name = type.typeName;

  return propertyName(name) === EXECUTOR_TYPE || propertyName(name?.right) === EXECUTOR_TYPE;
}

/** The function is the executor handed to `.intent(name, schema, executor)`. */
function isIntentArgument(fn) {
  const call = fn.parent;
  if (call?.type !== "CallExpression" || call.arguments?.[2] !== fn) return false;

  return (
    call.callee?.type === "MemberExpression" && propertyName(call.callee.property) === "intent"
  );
}

function isExecutor(fn) {
  if (namesExecutor(fn.returnType)) return true;
  if (fn.parent?.type === "VariableDeclarator" && namesExecutor(fn.parent.id?.typeAnnotation)) {
    return true;
  }

  return isIntentArgument(fn);
}

/** The destination kind's own `requestDelivery` member delegating to its service. */
function isImplementation(node) {
  const isMember = node.type === "PropertyDefinition" || node.type === "MethodDefinition";

  return isMember && propertyName(node.key) === OPERATION;
}

function isAllowed(call) {
  for (let current = call.parent; current; current = current.parent) {
    if (isImplementation(current)) return true;
    if (FUNCTION_TYPES.has(current.type) && isExecutor(current)) return true;
  }

  return false;
}

export const requestDeliveryFromAnIntentRule = defineRule({
  name: "request-delivery-from-an-intent",
  kind: "problem",
  messages: {
    requestDeliveryOutsideIntent: {
      what: "`{{callee}}.requestDelivery(...)` is called outside an outbox intent executor.",
      why: "Outside an intent it sends for a step that may roll back, or loses the request if the process dies mid-step.",
      fix: "Record a deliver intent in the producer's commit and call requestDelivery from that intent's `IntentExecutor` (ADR-167). Read the `eventing-and-worker` skill.",
    },
  },
  applies: (file) => file.role === "process" && file.isProduction,
  create(context) {
    return {
      CallExpression(node) {
        if (!isRequestDeliveryCall(node) || isAllowed(node)) return;
        const callee = context.sourceCode.getText(node.callee.object);
        context.report({ node, messageId: "requestDeliveryOutsideIntent", data: { callee } });
      },
    };
  },
});
