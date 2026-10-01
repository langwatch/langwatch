// Finding the handler a transport route declares, and reading the names in
// it, for `transport-declares`. Every helper takes the ESTree oxlint hands a
// rule; none parses or reads the disk.

const FUNCTION_EXPRESSIONS = new Set(["ArrowFunctionExpression", "FunctionExpression"]);
const TYPE_WRAPPERS = new Set(["TSAsExpression", "TSSatisfiesExpression", "TSTypeAssertion"]);
const FLUENT_ENDPOINT_METHODS = new Set([
  "withAuth",
  "withInput",
  "withOutput",
  "withPermission",
  "withoutPermission",
  "withStatus",
  "withMiddleware",
  "withRateLimit",
  "withoutRateLimit",
  "withResourceLimit",
  "withoutResourceLimit",
]);
const ROUTE_VERBS = new Set(["delete", "get", "patch", "post", "put", "register"]);
const PRODUCED_BY_DECLARATION = new Map([
  ["withRawBody", ["raw"]],
  ["withMultipart", ["files"]],
]);
const REQUEST_READING_KINDS = new Set(["protocol", "forwarded"]);
const HANDLER_ARGUMENT = new Map([
  ["handle", 0],
  ["register", 2],
  ["registerRoute", 3],
]);

export function isFunctionExpression(node) {
  return FUNCTION_EXPRESSIONS.has(node?.type);
}

/** `x as T`, `x satisfies T` and `<T>x` all name the same value as `x`. */
export function unwrapTypeAssertions(node) {
  let current = node;
  while (TYPE_WRAPPERS.has(current?.type)) current = current.expression;

  return current;
}

/** `a.name`'s `name`; a computed member has none. */
export function propertyName(node) {
  if (node?.type !== "MemberExpression" || node.computed) return undefined;

  return node.property.name;
}

/** `a["key"]`'s `key`. */
export function stringKey(node) {
  if (node?.type !== "MemberExpression" || !node.computed) return undefined;
  const { value } = node.property;

  return typeof value === "string" ? value : undefined;
}

/** `ctx.app.traces` as `["ctx", "app", "traces"]`; any other shape has no path. */
export function propertyPath(node) {
  if (node?.type === "Identifier") return [node.name];
  if (node?.type === "ChainExpression") return propertyPath(node.expression);
  const name = propertyName(node);
  const parent = name === undefined ? undefined : propertyPath(node.object);

  return parent && [...parent, name];
}

/**
 * One destructured binding: `{ key: target }`, `{ key = fallback }` or `...rest`.
 * `name` is an identifier key; `key` also accepts a string-literal one.
 */
export function bindingElement(element) {
  if (element.type === "RestElement") {
    const { name } = element.argument;

    return { key: name, local: name, name, rest: true, target: element.argument };
  }
  const { value } = element;
  const target = value?.type === "AssignmentPattern" ? value.left : value;
  const key = element.computed ? undefined : element.key;
  const name = key?.type === "Identifier" ? key.name : undefined;
  const literal = typeof key?.value === "string" ? key.value : undefined;
  const local = target?.type === "Identifier" ? target.name : undefined;

  return { key: name ?? literal, local, name, rest: false, target };
}

/** The pattern a parameter binds, through a default value or a constructor property. */
export function parameterPattern(parameter) {
  if (parameter?.type === "AssignmentPattern") return parameter.left;
  if (parameter?.type === "TSParameterProperty") return parameter.parameter;

  return parameter;
}

function declarationOf(statement) {
  const exported = statement.type.startsWith("Export") && statement.declaration;

  return exported || statement;
}

/** The program's statements, with each `export` unwrapped to what it declares. */
export function topLevelStatements(program) {
  return program.body.map(declarationOf);
}

function methodKeyName(method) {
  if (method.computed) return undefined;
  const { key } = method;
  if (key.type === "Identifier") return key.name;

  return typeof key.value === "string" ? key.value : undefined;
}

function classMethods(declaration) {
  return declaration.body.body
    .filter((member) => member.type === "MethodDefinition" && member.kind === "method")
    .filter((method) => method.value.body && methodKeyName(method) !== undefined)
    .map((method) => [methodKeyName(method), method.value]);
}

function functionsDeclaredBy(statement) {
  if (statement.type === "FunctionDeclaration") {
    return statement.id && statement.body ? [[statement.id.name, statement]] : [];
  }
  if (statement.type === "VariableDeclaration") {
    return statement.declarations
      .filter((declaration) => declaration.id.type === "Identifier")
      .filter((declaration) => isFunctionExpression(declaration.init))
      .map((declaration) => [declaration.id.name, declaration.init]);
  }

  return statement.type === "ClassDeclaration" ? classMethods(statement) : [];
}

/** Every named top-level function and class method; a name declared twice resolves to none. */
export function localFunctions(program) {
  const functions = new Map();
  const ambiguous = new Set();
  for (const [name, declaration] of topLevelStatements(program).flatMap(functionsDeclaredBy)) {
    if (functions.has(name)) {
      functions.delete(name);
      ambiguous.add(name);
    } else if (!ambiguous.has(name)) {
      functions.set(name, declaration);
    }
  }

  return functions;
}

function boundMethodName(node) {
  if (node.type !== "CallExpression" || propertyName(node.callee) !== "bind") return undefined;

  return propertyName(node.callee.object);
}

/** The function a handler argument names: inline, a local function, or `this.method(.bind)`. */
export function resolveHandler(candidate, functions) {
  const node = unwrapTypeAssertions(candidate);
  if (!node) return undefined;
  if (isFunctionExpression(node)) return node;
  if (node.type === "Identifier") return functions.get(node.name);
  const name = propertyName(node) ?? boundMethodName(node);

  return name === undefined ? undefined : functions.get(name);
}

/** The handler argument of `.handle(h)`, `.register(_, _, h)` or `.registerRoute(_, _, _, h)`. */
export function endpointHandlerArgument(call) {
  const index = HANDLER_ARGUMENT.get(propertyName(call.callee));

  return index === undefined ? undefined : call.arguments[index];
}

function hasFluentReceiver(call) {
  let receiver = call.callee.object;
  while (receiver?.type === "CallExpression") {
    const name = propertyName(receiver.callee);
    if (name === undefined) return false;
    if (FLUENT_ENDPOINT_METHODS.has(name)) return true;
    receiver = receiver.callee.object;
  }

  return false;
}

function isRouteCallbackArgument(node) {
  const call = node.parent;
  if (call?.type !== "CallExpression") return false;

  return ROUTE_VERBS.has(propertyName(call.callee)) && call.arguments.includes(node);
}

function isInsideRouteCallback(call) {
  for (let node = call.parent; node; node = node.parent) {
    if (isFunctionExpression(node) && isRouteCallbackArgument(node)) return true;
  }

  return false;
}

/** `.handle(...)` closing a fluent endpoint chain, or inside a route verb's callback. */
function isFluentEndpointHandle(call) {
  return hasFluentReceiver(call) || isInsideRouteCallback(call);
}

/** What one link of a route chain hands its handler, as `@langwatch/api/rest` declares it. */
function fieldsProducedBy(link) {
  const name = propertyName(link.callee);
  if (name !== "withResponse") return PRODUCED_BY_DECLARATION.get(name) ?? [];
  const [kind] = link.arguments;
  const readsRequest = kind?.type === "Literal" && REQUEST_READING_KINDS.has(kind.value);

  return readsRequest ? ["response", "request"] : ["response"];
}

/** The context fields a `.handle(h)` call's own route declared, read back to its verb. */
export function declaredProducerFields(call) {
  const fields = new Set();
  let link = call.callee.object;
  while (link?.type === "CallExpression") {
    for (const field of fieldsProducedBy(link)) fields.add(field);
    const name = propertyName(link.callee);
    if (name === undefined || ROUTE_VERBS.has(name)) break;
    link = link.callee.object;
  }

  return fields;
}

/** How a call registers a handler: fluent `.handle(h)`, legacy `.registerRoute(...)`, or not. */
export function handlerRegistration(call) {
  const name = propertyName(call.callee);
  const [first, , , fourth] = call.arguments;
  if (name === "handle" && first && isFluentEndpointHandle(call)) {
    return { candidate: first, fluent: true };
  }

  return name === "registerRoute" && fourth ? { candidate: fourth, fluent: false } : undefined;
}
