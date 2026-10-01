import { childNodes, walk } from "../ast.mjs";
import {
  bindingElement,
  declaredProducerFields,
  isFunctionExpression,
  parameterPattern,
  propertyName,
  propertyPath,
  stringKey,
  topLevelStatements,
} from "./transport-handlers.mjs";

// What `transport-declares` reads inside one route handler. Each check takes
// the handler and a `tools` pair: `report(node, messageId, data)` and
// `text(node)`, the node's source as written. `produced` holds the fields the
// handler's own route chain declared a producer for (`declaredProducerFields`).

const ALLOWED_HANDLER_FIELDS = new Set(["input", "app", "actor", "scope", "signal"]);
const RAW_CONTEXT_FIELDS = new Set([
  "ctx",
  "context",
  "req",
  "request",
  "session",
  "headers",
  "res",
  "response",
]);
const RESPONSE_METHODS = new Set([
  "json",
  "body",
  "text",
  "html",
  "redirect",
  "status",
  "header",
  "headers",
]);
const CONTROL_FLOW = new Set([
  "IfStatement",
  "SwitchStatement",
  "ForStatement",
  "ForInStatement",
  "ForOfStatement",
  "WhileStatement",
  "DoWhileStatement",
  "TryStatement",
]);
const FUNCTIONS = new Set(["ArrowFunctionExpression", "FunctionDeclaration", "FunctionExpression"]);
const SERVICE_OR_REPOSITORY = /(?:App|Service|Repository)$/;
const SERVICE_OR_REPOSITORY_FACTORY = /^create[A-Z].*(?:App|Service|Repository)$/;
const HANDLER_STATEMENT_LIMIT = 6;
const PRESENCE_OPERATORS = new Set(["===", "=="]);
const EMPTY_LITERALS = new Set([null, "", 0]);

const NOTHING_PRODUCED = new Set();

function isHandedOver(field, produced) {
  return ALLOWED_HANDLER_FIELDS.has(field) || produced.has(field);
}

/** A destructured context field the framework does not hand this route's handler. */
function reportContextBinding({ element, produced, tools }) {
  const binding = bindingElement(element);
  if (binding.rest) {
    tools.report(element, "rawContextSpread", { name: binding.name });

    return binding;
  }
  if (binding.name !== undefined && !isHandedOver(binding.name, produced)) {
    tools.report(element, "rawContextField", { field: binding.name });

    return binding;
  }

  return undefined;
}

function reportRawAccess({ body, name, produced, tools }) {
  walk(body, (node) => {
    if (node.type !== "MemberExpression" || node.object.type !== "Identifier") return;
    const field = propertyName(node) ?? stringKey(node);
    const raw = RAW_CONTEXT_FIELDS.has(field) && !produced.has(field);
    if (node.object.name === name && raw) {
      tools.report(node, "rawContextAccess", { text: tools.text(node) });
    }
  });
}

/** `const c = ctx` and `const { req } = ctx`: names the handler's context also goes by. */
function contextAliases({ body, produced, root, tools }) {
  const names = new Set([root]);
  walk(body, (node) => {
    const aliased = node.type === "VariableDeclarator" && names.has(node.init?.name);
    if (!aliased || node.init.type !== "Identifier") return;
    if (node.id.type === "Identifier") names.add(node.id.name);
    for (const element of node.id.properties ?? []) {
      const raw = reportContextBinding({ element, produced, tools });
      if (raw?.local) names.add(raw.local);
    }
  });

  return names;
}

function topLevelHandlerNamed(program, name) {
  for (const statement of topLevelStatements(program)) {
    if (statement.type === "FunctionDeclaration" && statement.id?.name === name) return statement;
    const declarations = statement.type === "VariableDeclaration" ? statement.declarations : [];
    const found = declarations.find((declaration) => declaration.id.name === name);
    if (isFunctionExpression(found?.init)) return found.init;
  }

  return undefined;
}

function declaredHandler(call, program) {
  const [argument] = call.arguments;
  if (argument?.type === "Identifier") return topLevelHandlerNamed(program, argument.name);

  return FUNCTIONS.has(argument?.type) ? argument : undefined;
}

/** `.handle(h)` in any source that declares transports: `h` takes only the framework's fields. */
export function inspectDeclaredHandler({ call, program, tools }) {
  const handler = declaredHandler(call, program);
  const produced = declaredProducerFields(call);
  const pattern = parameterPattern(handler?.params[0]);
  if (pattern?.type === "ObjectPattern") {
    const raw = pattern.properties.map((element) =>
      reportContextBinding({ element, produced, tools }),
    );
    for (const binding of raw) {
      if (!binding?.local || binding.rest) continue;
      reportRawAccess({ body: handler.body, name: binding.local, produced, tools });
    }
  }
  if (pattern?.type !== "Identifier") return;
  const { body } = handler;
  for (const name of contextAliases({ body, produced, root: pattern.name, tools })) {
    reportRawAccess({ body, name, produced, tools });
  }
}

function boundaryReaders(aliases) {
  const startsAtContext = (node) => {
    const path = propertyPath(node);

    return path?.length === 1 && aliases.has(path[0]);
  };
  const isContextMember = (node) =>
    startsAtContext(node) || (stringKey(node) !== undefined && startsAtContext(node.object));
  const directMember = (node) => {
    const name = propertyName(node) ?? stringKey(node);

    return name !== undefined && isContextMember(node.object) ? name : undefined;
  };

  return { directMember, startsAtContext };
}

function inspectMemberAccess({ node, produced, readers, tools }) {
  const own = propertyName(node) ?? stringKey(node);
  if (own === "headers") {
    tools.report(node, "transportHeaders", { text: tools.text(node) });

    return;
  }
  const member = readers.directMember(node);
  const raw = RAW_CONTEXT_FIELDS.has(member) && !produced.has(member);
  if (member !== "session" && raw) {
    tools.report(node, "rawContextAccess", { text: tools.text(node) });
  }
}

function isNoContent(node) {
  return node?.name === "NO_CONTENT" || propertyName(node) === "NO_CONTENT";
}

function inspectResponseShaping(node, readers, tools) {
  const method = node.type === "CallExpression" ? propertyName(node.callee) : undefined;
  if (RESPONSE_METHODS.has(method)) tools.report(node, "responseMethod", { name: method });
  if (node.type === "NewExpression" && node.callee.name === "Response") {
    tools.report(node, "rawResponse");
  }
  const assigned = node.type === "AssignmentExpression" && node.operator === "=";
  if (assigned && readers.directMember(node.left) !== undefined) {
    tools.report(node, "responseMutation", { text: tools.text(node.left) });
  }
  if (node.type === "ReturnStatement" && isNoContent(node.argument)) {
    tools.report(node.argument, "noContentSentinel");
  }
}

/** A route's handler: the fields its route hands over in, a value or a producer's answer out. */
export function inspectHandlerBoundary({ handler, produced = NOTHING_PRODUCED, tools }) {
  const pattern = parameterPattern(handler.params[0]);
  const aliases = new Set(pattern?.type === "Identifier" ? [pattern.name] : []);
  for (const element of pattern?.type === "ObjectPattern" ? pattern.properties : []) {
    reportContextBinding({ element, produced, tools });
  }
  const readers = boundaryReaders(aliases);
  walk(handler.body, (node) => {
    const aliasing = node.type === "VariableDeclarator" && node.id.type === "Identifier";
    if (aliasing && readers.startsAtContext(node.init)) aliases.add(node.id.name);
    if (node.type === "MemberExpression") inspectMemberAccess({ node, produced, readers, tools });
    inspectResponseShaping(node, readers, tools);
  });
}

function contextParameterNames(handler) {
  return new Set(
    handler.params
      .map(parameterPattern)
      .filter((pattern) => pattern?.type === "Identifier")
      .map((pattern) => pattern.name),
  );
}

function isAppPath(path, contextNames) {
  return path.length >= 3 && contextNames.has(path[0]) && path[1] === "app";
}

function bindOperationAlias({ aliases, contextNames, path, target }) {
  if (target?.type === "Identifier") {
    if (isAppPath(path, contextNames) || aliases.has(path[0])) aliases.add(target.name);

    return;
  }
  for (const element of target?.type === "ObjectPattern" ? target.properties : []) {
    const binding = bindingElement(element);
    if (binding.rest || binding.key === undefined) continue;
    const nested = [...path, binding.key];
    bindOperationAlias({ aliases, contextNames, path: nested, target: binding.target });
  }
}

/** Names bound from `ctx.app.<module>`, directly or through another such name. */
function operationAliases(body, contextNames) {
  const aliases = new Set();
  walk(body, (node) => {
    const path = node.type === "VariableDeclarator" ? propertyPath(node.init) : undefined;
    if (path) bindOperationAlias({ aliases, contextNames, path, target: node.id });
  });

  return aliases;
}

function collectShape(node, nested, state) {
  const inNested = nested || (node !== state.body && FUNCTIONS.has(node.type));
  if (!inNested && CONTROL_FLOW.has(node.type)) state.flow.push(node);
  if (node.type === "CallExpression" && state.isOperationCall(node)) {
    state.calls.push(node);
    if (inNested) state.nested.push(node);
  }
  for (const child of childNodes(node)) collectShape(child, inNested, state);
}

function operationCallTest(handler) {
  const contextNames = contextParameterNames(handler);
  const aliases = operationAliases(handler.body, contextNames);

  return (call) => {
    const path =
      propertyName(call.callee) === undefined ? undefined : propertyPath(call.callee.object);
    if (!path) return false;

    return aliases.has(path[0]) || isAppPath(path, contextNames);
  };
}

function inputRoots(handler) {
  const [context, positional] = handler.params.map(parameterPattern);
  const roots = new Set(positional?.type === "Identifier" ? [positional.name] : []);
  const fields = new Set();
  for (const element of context?.type === "ObjectPattern" ? context.properties : []) {
    const binding = bindingElement(element);
    if (binding.key !== "input" || binding.rest) continue;
    if (binding.local) roots.add(binding.local);
    for (const field of binding.target?.type === "ObjectPattern" ? binding.target.properties : []) {
      const local = bindingElement(field).local;
      if (local) fields.add(local);
    }
  }

  return { contextNames: contextParameterNames(handler), fields, roots };
}

function inputPathDepth(path, input) {
  if (!path) return 0;
  if (input.roots.has(path[0])) return path.length;

  return input.contextNames.has(path[0]) && path[1] === "input" ? path.length - 1 : 0;
}

/** `const { projectId, ...body } = input` and `const projectId = input.projectId`. */
function bindInputAliases(body, input) {
  walk(body, (node) => {
    if (node.type !== "VariableDeclarator") return;
    const depth = inputPathDepth(propertyPath(node.init), input);
    if (depth === 0) return;
    if (node.id.type === "Identifier") (depth === 1 ? input.roots : input.fields).add(node.id.name);
    if (node.id.type === "ObjectPattern") bindPatternAliases(node.id, input);
  });
}

function bindPatternAliases(pattern, input) {
  for (const element of pattern.properties) {
    const binding = bindingElement(element);
    if (binding.local) (binding.rest ? input.roots : input.fields).add(binding.local);
  }
}

function isInputField(node, input) {
  const value = node.type === "ChainExpression" ? node.expression : node;
  if (value.type === "Identifier") return input.fields.has(value.name);
  const trimmed = value.type === "CallExpression" && propertyName(value.callee) === "trim";
  if (trimmed) return isInputField(value.callee.object, input);

  return inputPathDepth(propertyPath(value), input) >= 2;
}

function isEmptyValue(node) {
  if (node.type === "Identifier") return node.name === "undefined";
  if (node.type === "UnaryExpression") return node.operator === "void";

  return node.type === "Literal" && EMPTY_LITERALS.has(node.value);
}

function isPresenceCheck(test, input) {
  if (test.type === "UnaryExpression")
    return test.operator === "!" && isInputField(test.argument, input);
  if (test.type === "LogicalExpression") {
    return isPresenceCheck(test.left, input) && isPresenceCheck(test.right, input);
  }
  if (test.type !== "BinaryExpression" || !PRESENCE_OPERATORS.has(test.operator)) return false;
  const leftField = isInputField(test.left, input) && isEmptyValue(test.right);

  return leftField || (isInputField(test.right, input) && isEmptyValue(test.left));
}

function onlyThrows(statement) {
  const body = statement.type === "BlockStatement" ? statement.body : [statement];

  return body.length === 1 && body[0].type === "ThrowStatement";
}

/** `if (!input.projectId) throw …`: the handler refuses what the route's schema should. */
function inputCheckTest(handler) {
  const input = inputRoots(handler);
  bindInputAliases(handler.body, input);

  return (node) =>
    node.type === "IfStatement" &&
    !node.alternate &&
    onlyThrows(node.consequent) &&
    isPresenceCheck(node.test, input);
}

/** One operation on `app`, no branching, a short body: a handler declares, it does not decide. */
export function inspectHandlerShape(handler, tools) {
  const state = {
    body: handler.body,
    calls: [],
    flow: [],
    isOperationCall: operationCallTest(handler),
    nested: [],
  };
  collectShape(handler.body, false, state);
  if (state.calls.length > 1) {
    tools.report(state.calls[1], "multipleOperationCalls", { count: state.calls.length });
  }
  if (state.nested.length > 0) tools.report(state.nested[0], "nestedOperationCall");
  const isInputCheck = inputCheckTest(handler);
  for (const check of state.flow.filter(isInputCheck)) {
    tools.report(check, "handlerChecksInput", { test: tools.text(check.test) });
  }
  const decision = state.flow.find((node) => !isInputCheck(node));
  if (decision) tools.report(decision, "handlerControlFlow");
  const statements = handler.body.type === "BlockStatement" ? handler.body.body.length : 0;
  if (statements > HANDLER_STATEMENT_LIMIT) {
    tools.report(handler.body, "handlerTooLong", {
      count: statements,
      max: HANDLER_STATEMENT_LIMIT,
    });
  }
}

function expressionName(node) {
  return node.type === "Identifier" ? node.name : propertyName(node);
}

function constructedName(node, importedAs) {
  const canonical = (local) => (local === undefined ? undefined : (importedAs.get(local) ?? local));
  if (node.type === "NewExpression") {
    const name = canonical(expressionName(node.callee));

    return SERVICE_OR_REPOSITORY.test(name ?? "") ? name : undefined;
  }
  if (node.type !== "CallExpression") return undefined;
  if (node.callee.type === "Identifier") {
    const name = canonical(node.callee.name);

    return SERVICE_OR_REPOSITORY_FACTORY.test(name) ? name : undefined;
  }
  const created =
    propertyName(node.callee) === "create"
      ? canonical(expressionName(node.callee.object))
      : undefined;

  return SERVICE_OR_REPOSITORY.test(created ?? "") ? created : undefined;
}

/** A handler that builds a service or repository has built its own module graph. */
export function inspectHandlerConstruction(handler, importedAs, tools) {
  walk(handler.body, (node) => {
    const name = constructedName(node, importedAs);
    if (name) tools.report(node, "handlerConstructs", { name });
  });
}
