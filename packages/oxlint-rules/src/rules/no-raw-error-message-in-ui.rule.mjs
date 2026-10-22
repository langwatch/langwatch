import { childNodes } from "../ast.mjs";
import { defineRule } from "../define-rule.mjs";
import { isBrowserCode, isFunction } from "../react-state.mjs";

// A caught error's `.message` is not customer copy: the customer's words come from the
// presentation registry, keyed by the error's code. Syntactic, biased to false negatives.
// The full contract: dev/docs/adr/182-platform-blocks-architecture-drift.md

const TOAST_RECEIVERS = new Set(["toast", "toaster"]);
const TOAST_FUNCTIONS = new Set(["toast", "toaster", "showToast", "createToast"]);
const SETTER = /^set[A-Z]/;
const FAILURE_MEMBER = new Set(["error", "failure"]);
const FAILURE_IDENTIFIER = /^[a-z][A-Za-z0-9]*(?:Error|Failure)$/;
const RESULT_IDENTIFIER = /^(?:result|[a-z][A-Za-z0-9]*Result)$/;
const HOOK_RESULT_TYPE = /HookResult$/;
const DATA_HOLDERS = new Set(["trace", "span", "detail", "fieldState"]);
const FORM_STATE_NAMES = new Set(["fieldState", "formState", "errors", "getFieldState"]);
const FIELD_ERROR_GETTER = /^get[A-Za-z0-9]*Errors?$/;
// String methods whose result is still the message's text.
const TEXT_METHODS = new Set([
  "trim",
  "trimStart",
  "trimEnd",
  "toLowerCase",
  "toUpperCase",
  "slice",
  "substring",
  "substr",
  "replace",
  "replaceAll",
  "concat",
  "padStart",
  "padEnd",
  "normalize",
  "at",
  "charAt",
]);
// Calls that read an error properly, or turn text into something that is not text.
const NON_CARRYING_CALLS = new Set([
  "describeError",
  "readHandledError",
  "explainAnyError",
  "Boolean",
]);
const TRANSPARENT = new Set([
  "ChainExpression",
  "ParenthesizedExpression",
  "TSAsExpression",
  "TSNonNullExpression",
  "TSSatisfiesExpression",
  "TSTypeAssertion",
]);

function unwrap(node) {
  let current = node;
  while (current && TRANSPARENT.has(current.type)) current = current.expression;

  return current;
}

function typeName(annotation) {
  const type = annotation?.typeAnnotation ?? annotation;
  if (type?.type !== "TSTypeReference") return undefined;
  const name = type.typeName;

  return name?.type === "Identifier" ? name.name : name?.right?.name;
}

// The names a function's parameters bind to a `*HookResult`: `(result: ScenarioHookResult)` and
// `({ result }: { result: ScenarioHookResult })`.
function hookResultParameters(fn) {
  const names = new Set();
  for (const param of fn.params ?? []) addHookResultParameter(bindingTarget(param), names);

  return names;
}

function isHookResultAnnotation(annotation) {
  return HOOK_RESULT_TYPE.test(typeName(annotation) ?? "");
}

function addHookResultParameter(target, names) {
  const isIdentifier = target.type === "Identifier";
  if (isIdentifier && isHookResultAnnotation(target.typeAnnotation)) names.add(target.name);
  if (target.type === "ObjectPattern") addHookResultProperties(target, names);
}

function addHookResultProperties(target, names) {
  const literal = target.typeAnnotation?.typeAnnotation;
  if (literal?.type !== "TSTypeLiteral") return;
  for (const member of literal.members) {
    const key = member.key?.name;
    if (key && isHookResultAnnotation(member.typeAnnotation)) {
      addPropertyBindings(target, key, names);
    }
  }
}

function addPropertyBindings(target, key, names) {
  for (const property of target.properties) {
    const isProperty = property.type === "Property";
    if (isProperty && propertyName(property.key) === key) patternNames(property.value, names);
  }
}

function patternNames(pattern, into) {
  if (!pattern) return;
  if (pattern.type === "Identifier") into.add(pattern.name);
  else if (pattern.type === "AssignmentPattern") patternNames(pattern.left, into);
}

/** Every name a binding pattern introduces, however deeply destructured. */
function bindingNames(pattern, into) {
  if (!pattern) return;
  if (pattern.type === "Identifier") into.add(pattern.name);
  else if (pattern.type === "AssignmentPattern") bindingNames(pattern.left, into);
  else if (pattern.type === "RestElement") bindingNames(pattern.argument, into);
  else if (pattern.type === "ArrayPattern") {
    for (const element of pattern.elements) bindingNames(element, into);
  } else if (pattern.type === "ObjectPattern") {
    for (const property of pattern.properties) bindingNames(property.value ?? property, into);
  }
}

function bindingTarget(pattern) {
  return pattern?.type === "AssignmentPattern" ? pattern.left : pattern;
}

function propertyName(node) {
  if (!node) return undefined;
  if (node.type === "Identifier") return node.name;
  if (node.type === "Literal" && typeof node.value === "string") return node.value;

  return undefined;
}

function calleeName(call) {
  const callee = unwrap(call.callee);
  if (callee?.type === "Identifier") return callee.name;
  if (isPlainMember(callee)) return callee.property?.name;

  return undefined;
}

function isPlainMember(node) {
  return node?.type === "MemberExpression" && !node.computed;
}

function firstFound(items, find) {
  for (const item of items) {
    const found = find(item);
    if (found) return found;
  }

  return undefined;
}

// One frame per function or catch clause: the names that are errors, and the const aliases of
// one's message.
function newFrame(scenarioHooks = new Set()) {
  return {
    errors: new Set(),
    hookResults: new Set(),
    tainted: new Set(),
    fieldErrors: new Set(),
    scenarioHooks,
  };
}

function frameHas(frames, kind, name) {
  return frames.some((frame) => frame[kind].has(name));
}

function isFormStateName(name) {
  return name !== undefined && (FORM_STATE_NAMES.has(name) || FIELD_ERROR_GETTER.test(name));
}

// Whether an expression is read off react-hook-form state: `formState.errors.x`,
// `form.getFieldState("a").error`, `shared.getMessageError(idx, "content")`.
function isFormStateRead(frames, node) {
  const value = unwrap(node);
  if (value?.type === "Identifier") {
    return FORM_STATE_NAMES.has(value.name) || frameHas(frames, "fieldErrors", value.name);
  }
  if (value?.type === "CallExpression") {
    return isFormStateName(calleeName(value)) || isFormStateRead(frames, value.callee);
  }
  if (value?.type === "MemberExpression") {
    const name = value.computed ? undefined : propertyName(value.property);

    return isFormStateName(name) || isFormStateRead(frames, value.object);
  }

  return false;
}

// `mutation.error`, `query.error`: the `error` of a hook result bound in this file. Any other
// `.error` is data (a span's recorded exception, a typed failure) and not a caught error.
function isErrorSource(frames, node) {
  const value = unwrap(node);
  if (value?.type === "Identifier") return frameHas(frames, "errors", value.name);
  if (!isPlainMember(value)) return false;
  const holder = unwrap(value.object);

  return (
    propertyName(value.property) === "error" &&
    holder?.type === "Identifier" &&
    frameHas(frames, "hookResults", holder.name)
  );
}

// `run.error.message`, `queryError.message`: the message of a value named as a failure.
function isFailureValue(frames, node) {
  const value = unwrap(node);
  if (value?.type === "Identifier") {
    return FAILURE_IDENTIFIER.test(value.name) && !frameHas(frames, "fieldErrors", value.name);
  }
  if (!isPlainMember(value)) return false;
  if (!FAILURE_MEMBER.has(propertyName(value.property))) return false;
  const holderName = nameOfHolder(unwrap(value.object));

  return holderName !== undefined && !DATA_HOLDERS.has(holderName);
}

// `result.error`: the failure text a result value carries.
function isResultFailure(frames, node) {
  if (!isPlainMember(node) || propertyName(node.property) !== "error") return false;
  const holder = unwrap(node.object);

  return (
    holder?.type === "Identifier" &&
    RESULT_IDENTIFIER.test(holder.name) &&
    !frameHas(frames, "scenarioHooks", holder.name)
  );
}

function isRawRead(frames, node, sink) {
  if (!isPlainMember(node)) return false;
  if (sink === "jsx" && isResultFailure(frames, node)) return true;

  return (
    propertyName(node.property) === "message" &&
    (isErrorSource(frames, node.object) || isFailureValue(frames, node.object))
  );
}

// `String(e)`, `e.toString()`: the caught error itself turned into text.
function isStringifiedError(frames, call) {
  const callee = unwrap(call.callee);
  if (callee?.type === "Identifier" && callee.name === "String") {
    return call.arguments.length === 1 && isErrorSource(frames, call.arguments[0]);
  }

  return (
    isPlainMember(callee) &&
    propertyName(callee.property) === "toString" &&
    isErrorSource(frames, callee.object)
  );
}

function isOpaque(node) {
  return isFunction(node) || node.type === "NewExpression";
}

// The first raw message, or alias of one, that an expression hands on as its own value.
function findRaw(frames, node, sink) {
  if (!node || isOpaque(node)) return undefined;
  if (TRANSPARENT.has(node.type)) return findRaw(frames, node.expression, sink);
  if (isRawRead(frames, node, sink)) return node;
  const finder = RAW_FINDERS.get(node.type) ?? findRawInChildren;

  return finder(frames, node, sink);
}

function findRawInChildren(frames, node, sink) {
  return firstFound(childNodes(node), (child) => findRaw(frames, child, sink));
}

// In a template or a `+`, the caught error itself is stringified too.
function findRawInOperands(frames, operands, sink) {
  for (const operand of operands) {
    if (isErrorSource(frames, operand)) return unwrap(operand);
    const found = findRaw(frames, operand, sink);
    if (found) return found;
  }

  return undefined;
}

function findRawInBinary(frames, node, sink) {
  if (node.operator !== "+") return findRawInChildren(frames, node, sink);

  return findRawInOperands(frames, [node.left, node.right], sink);
}

function findRawInConditional(frames, node, sink) {
  // A `SyntaxError` is raised by the screen's own parse of what the customer typed.
  if (isSyntaxErrorCheck(node.test)) return findRaw(frames, node.alternate, sink);

  return findRaw(frames, node.consequent, sink) ?? findRaw(frames, node.alternate, sink);
}

function findRawInLogical(frames, node, sink) {
  const right = findRaw(frames, node.right, sink);
  if (node.operator === "&&") return right;

  return findRaw(frames, node.left, sink) ?? right;
}

// A call hands the message on through its arguments, or through a string method on it.
function findRawInCall(frames, call, sink) {
  if (isStringifiedError(frames, call)) return call;
  const viaTextMethod = findRawThroughTextMethod(frames, call, sink);
  if (viaTextMethod) return viaTextMethod;
  if (NON_CARRYING_CALLS.has(calleeName(call) ?? "")) return undefined;

  return firstFound(call.arguments, (argument) => findRaw(frames, argument, sink));
}

function findRawThroughTextMethod(frames, call, sink) {
  const callee = unwrap(call.callee);
  if (!isPlainMember(callee)) return undefined;
  if (!TEXT_METHODS.has(propertyName(callee.property))) return undefined;

  return findRaw(frames, callee.object, sink);
}

const nothing = () => undefined;

const RAW_FINDERS = new Map([
  ["CallExpression", findRawInCall],
  ["TemplateLiteral", (frames, node, sink) => findRawInOperands(frames, node.expressions, sink)],
  ["BinaryExpression", findRawInBinary],
  ["Identifier", (frames, node) => (frameHas(frames, "tainted", node.name) ? node : undefined)],
  ["ConditionalExpression", findRawInConditional],
  ["LogicalExpression", findRawInLogical],
  ["MemberExpression", nothing],
  ["JSXElement", nothing],
  ["JSXFragment", nothing],
]);

function isSyntaxErrorCheck(test) {
  if (test?.type !== "BinaryExpression" || test.operator !== "instanceof") return false;
  const right = unwrap(test.right);

  return right?.type === "Identifier" && right.name === "SyntaxError";
}

function report(context, raw, sink) {
  context.report({
    node: raw,
    messageId: "rawErrorMessage",
    data: { expression: context.sourceCode.text.slice(raw.start, raw.end), sink },
  });
}

function isOnErrorSlot(parent) {
  if (parent?.type === "Property") return propertyName(parent.key) === "onError";
  if (parent?.type !== "JSXExpressionContainer") return false;
  const attribute = parent.parent;

  return attribute?.type === "JSXAttribute" && attribute.name?.name === "onError";
}

function isCatchCallback(fn) {
  const parent = fn.parent;

  return (
    parent?.type === "CallExpression" &&
    parent.arguments[0] === fn &&
    calleeName(parent) === "catch"
  );
}

// The error parameter of an `onError` or `.catch` callback.
function callbackParameter(fn) {
  const param = fn.params?.[0];
  if (param?.type !== "Identifier") return undefined;

  return isOnErrorSlot(fn.parent) || isCatchCallback(fn) ? param.name : undefined;
}

function enterFunction(frames, fn) {
  const frame = newFrame(hookResultParameters(fn));
  const name = callbackParameter(fn);
  if (name) frame.errors.add(name);
  frames.push(frame);
}

function enterCatch(frames, node) {
  const frame = newFrame();
  const param = node.param;
  if (param?.type === "Identifier") frame.errors.add(param.name);
  if (param?.type === "ObjectPattern") bindPropertyNamed(param, "message", frame.tainted);
  frames.push(frame);
}

function aliasesError(frames, init) {
  const value = unwrap(init);
  if (isErrorSource(frames, value)) return true;
  if (value?.type !== "ConditionalExpression") return false;

  return isErrorSource(frames, value.consequent) || isErrorSource(frames, value.alternate);
}

/** Records the name a destructuring pattern binds to its `key` property. */
function bindPropertyNamed(pattern, key, into) {
  for (const property of pattern.properties) {
    const isProperty = property.type === "Property";
    if (!isProperty || propertyName(property.key) !== key) continue;
    const value = bindingTarget(property.value);
    if (value?.type === "Identifier") into.add(value.name);
  }
}

function isHookCall(init) {
  const call = unwrap(init);
  if (call?.type !== "CallExpression") return false;

  return /^use[A-Z]/.test(calleeName(call) ?? "");
}

function isMessageHolder(frames, init) {
  return isErrorSource(frames, init) || isFailureValue(frames, init);
}

function recordDeclarator(frames, node) {
  const { id, init } = node;
  if (!init) return;
  const frame = frames.at(-1);
  const hookCall = isHookCall(init);
  const isPattern = id.type === "ObjectPattern";
  if (isPattern && hookCall) bindPropertyNamed(id, "error", frame.errors);
  // A `*Error` bound to something read off form state is a field error, not a failure.
  if (isFormStateRead(frames, init)) bindingNames(id, frame.fieldErrors);
  if (id.type === "Identifier") recordIdentifierBinding(frames, { name: id.name, init, hookCall });
  // `const { message } = e`: the message under its own name.
  if (isPattern && isMessageHolder(frames, init)) bindPropertyNamed(id, "message", frame.tainted);
}

function recordIdentifierBinding(frames, { name, init, hookCall }) {
  const frame = frames.at(-1);
  if (hookCall) frame.hookResults.add(name);
  // `const err = e as Error`, `const err = e instanceof Error ? e : wrap(e)`: still the error.
  if (aliasesError(frames, init)) frame.errors.add(name);
  if (findRaw(frames, init)) frame.tainted.add(name);
}

function checkJsxExpression(scope, node) {
  const raw = findRaw(scope.frames, node.expression, "jsx");
  if (!raw) return;
  const attribute = node.parent?.type === "JSXAttribute" ? node.parent : undefined;
  const attributeName = attribute?.name?.name;
  if (attribute && /^on[A-Z]/.test(attributeName ?? "")) return;
  report(scope.context, raw, attribute ? `the \`${attributeName}\` attribute` : "JSX");
}

function isToastCallee(callee) {
  if (callee?.type === "Identifier") return TOAST_FUNCTIONS.has(callee.name);
  if (callee?.type !== "MemberExpression") return false;
  const receiver = unwrap(callee.object);

  return receiver?.type === "Identifier" && TOAST_RECEIVERS.has(receiver.name);
}

/** The sink a call is, if it renders what it is handed: a toast, a setter, `form.setError`. */
function sinkOf(call) {
  const callee = unwrap(call.callee);
  const name = calleeName(call);
  const isToast = isToastCallee(callee);
  const isSetter = callee?.type === "Identifier" && SETTER.test(name ?? "");
  // `form.setError(name, { message })`: the form bridge renders the message verbatim.
  const isFormSetError = callee?.type === "MemberExpression" && name === "setError";
  if (!isToast && !isSetter && !isFormSetError) return undefined;

  return { isToast, isFormSetError, name };
}

function sinkCandidates(argument, spreadsObject) {
  const value = unwrap(argument);
  if (spreadsObject && value?.type === "ObjectExpression") {
    return value.properties.map((property) => property.value);
  }

  return [value];
}

function checkSinkCall(scope, call) {
  const sink = sinkOf(call);
  if (!sink) return;
  const spreadsObject = sink.isToast || sink.isFormSetError;
  for (const argument of call.arguments) {
    for (const candidate of sinkCandidates(argument, spreadsObject)) {
      const raw = findRaw(scope.frames, candidate);
      if (raw) report(scope.context, raw, sinkLabel(sink));
    }
  }
}

/** The name a member read's holder goes by: a bare identifier, or the last property of a path. */
function nameOfHolder(holder) {
  if (holder?.type === "Identifier") return holder.name;
  if (isPlainMember(holder)) return propertyName(holder.property);
  return undefined;
}

// The mail templates' local preview shows a developer the render error; no customer sees it.
const DEVELOPER_TOOLS = /^packages\/mail\/preview\//;

/** Browser code, plus every package: a shared component renders to the customer too. */
function isGovernedUiCode(file) {
  if (isBrowserCode(file)) return true;
  if (file.isTest) return false;

  return file.workspacePath.startsWith("packages/") && !DEVELOPER_TOOLS.test(file.workspacePath);
}

/** How a finding names the place the raw message reaches. */
function sinkLabel({ isToast, isFormSetError, name }) {
  if (isToast) return "a toast";
  if (isFormSetError) return "`setError`, which the form renders";
  return `\`${name}\`, which the screen renders`;
}

export const noRawErrorMessageInUiRule = defineRule({
  name: "no-raw-error-message-in-ui",
  kind: "problem",
  applies: (file) => isGovernedUiCode(file),
  messages: {
    rawErrorMessage: {
      what: "`{{expression}}` reaches the customer through {{sink}}.",
      why: "A handled error's wire message is its code slug, and an unhandled one can leak internals.",
      fix: "Pass the error to `showErrorToast({ error, fallbackTitle })`, `<HandledErrorAlert>` or `describeError`, so the words come from the registry keyed by code. Read the `browser-telemetry-and-errors` skill.",
    },
  },
  create(context) {
    const scope = { context, frames: [newFrame()] };
    const enter = (fn) => enterFunction(scope.frames, fn);
    const exit = () => void scope.frames.pop();

    return {
      FunctionDeclaration: enter,
      "FunctionDeclaration:exit": exit,
      FunctionExpression: enter,
      "FunctionExpression:exit": exit,
      ArrowFunctionExpression: enter,
      "ArrowFunctionExpression:exit": exit,
      CatchClause: (node) => enterCatch(scope.frames, node),
      "CatchClause:exit": exit,
      VariableDeclarator: (node) => recordDeclarator(scope.frames, node),
      JSXExpressionContainer: (node) => checkJsxExpression(scope, node),
      CallExpression: (node) => checkSinkCall(scope, node),
    };
  },
});
