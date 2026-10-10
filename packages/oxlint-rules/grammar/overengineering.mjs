import { walk } from "../src/ast.mjs";

// The three over-abstraction detectors, as one pass over the ESTree tree the
// linter already built: `layer-class`, `overload-by-literal` and
// `conditional-type-depth` each report their share of what this returns.

export const MIN_METHODS_FOR_LAYER = 5;
export const LAYER_DELEGATION_RATIO = 0.6;
export const MAX_CONDITIONAL_TYPE_DEPTH = 3;

/**
 * How many distinct collaborators a mostly-delegating class may forward to
 * before it counts as composition rather than a layer. One receiver is a
 * layer; several is a class assembling specialists behind one interface.
 */
export const MAX_DELEGATION_RECEIVERS = 1;

export const LAYER_CLASS_ALLOWED =
  "Hold the collaborator at the caller and delete the class, or give it the rules that justify it. `app/<feature>.app.ts` and routed repositories are exempt.";
export const CONDITIONAL_TYPE_DEPTH_ALLOWED =
  "State the shape rather than deriving it. A type this deep is usually re-computing something a plain interface, a discriminated union, or a `satisfies` clause already says.";
export const OVERLOAD_BY_LITERAL_ALLOWED =
  "Give the two behaviours two names, or one signature whose return type already admits the absent case. An overload set the reader has to diff is not documentation.";

/** The one facade the feature layout requires, and the routed repositories
 *  whose whole job is to pick a backend by the same verb. */
export function isExemptFromLayerRule(path) {
  return /\/app\/[^/]+\.app\.ts$/.test(path) || /\/repositories\/routed\//.test(path);
}

/** Whether the walker should hand this path to `overengineeringFindings`. */
export function isOverengineeringSource(path) {
  return (
    path.endsWith(".ts") &&
    !path.endsWith(".d.ts") &&
    !path.endsWith(".test.ts") &&
    !path.includes("/__tests__/") &&
    !path.includes("/generated/")
  );
}

const PROPERTY_MEMBERS = new Set(["PropertyDefinition", "TSAbstractPropertyDefinition"]);
const OVERLOADABLE = new Set([
  "FunctionDeclaration",
  "MethodDefinition",
  "TSAbstractMethodDefinition",
  "TSDeclareFunction",
  "TSMethodSignature",
]);
const EXPORT_WRAPPERS = new Set(["ExportNamedDeclaration", "ExportDefaultDeclaration"]);
const NAMED_TYPE_DECLARATIONS = new Set(["TSTypeAliasDeclaration", "TSInterfaceDeclaration"]);

function isHidden(member) {
  return member.accessibility === "private" || member.accessibility === "protected";
}

/**
 * A class member that behaves like a method: a method declaration with a body,
 * or a property initialised with an arrow, which is how facades bind `this`.
 */
function methodLike(member) {
  const key = member.key;
  if (!key || key.type !== "Identifier") return undefined;
  if (isHidden(member)) return undefined;

  const value = member.value;
  if (member.type === "MethodDefinition") {
    if (member.kind !== "method") return undefined;
    if (!value || value.type === "TSEmptyBodyFunctionExpression" || !value.body) return undefined;

    return { body: value.body, name: key.name, params: value.params ?? [] };
  }
  if (PROPERTY_MEMBERS.has(member.type) && value && value.type === "ArrowFunctionExpression") {
    return { body: value.body, name: key.name, params: value.params ?? [] };
  }

  return undefined;
}

/** The identifiers a parameter list binds, through rest, default and
 *  parameter-property wrappers. */
function parameterNames(params) {
  const names = new Set();
  for (const parameter of params) {
    let binding = parameter;
    if (binding.type === "TSParameterProperty") binding = binding.parameter;
    if (binding.type === "RestElement") binding = binding.argument;
    if (binding.type === "AssignmentPattern") binding = binding.left;
    if (binding && binding.type === "Identifier") names.add(binding.name);
  }

  return names;
}

/**
 * Whether the forward reshapes what it was given on the way through. A hop
 * that hands its own parameters straight on is what this policy is about;
 * anything that is not plainly a parameter or a spread counts as a transform.
 */
function transformsItsArguments(member, call) {
  const parameters = parameterNames(member.params);

  return call.arguments.some(
    (argument) =>
      argument.type !== "SpreadElement" &&
      !(argument.type === "Identifier" && parameters.has(argument.name)),
  );
}

/**
 * The receiver of a same-name delegation, as a dotted path, or undefined when
 * the body is anything else. The body must be nothing but
 * `this.<a>.<b>...<name>(...)`; `await` in front counts, a guard does not.
 */
function delegationReceiver(member) {
  const call = soleCallOf(member.body);
  const callee = call?.callee;
  if (callee?.type !== "MemberExpression" || callee.computed) return undefined;
  if (callee.property.name !== member.name || transformsItsArguments(member, call))
    return undefined;

  return thisPath(callee.object);
}

/** The one call a body makes: `x()`, `return x()`, `await x()` or `x?.()`; else undefined. */
function soleCallOf(body) {
  if (!body) return undefined;
  let expression = body;
  if (body.type === "BlockStatement") {
    const [only] = body.body;
    if (body.body.length !== 1 || only?.type !== "ReturnStatement") return undefined;
    expression = only.argument;
  }
  if (expression?.type === "AwaitExpression") expression = expression.argument;
  if (expression?.type === "ChainExpression") expression = expression.expression;

  return expression?.type === "CallExpression" ? expression : undefined;
}

/** `this.a.b` as `"a.b"`; a chain not rooted at `this` is undefined. */
function thisPath(receiver) {
  const path = [];
  let current = receiver;
  while (current.type === "MemberExpression" && !current.computed) {
    if (current.property.type !== "Identifier") return undefined;
    path.unshift(current.property.name);
    current = current.object;
  }

  return current.type === "ThisExpression" ? path.join(".") : undefined;
}

function conditionalDepth(node, covered) {
  if (!node || node.type !== "TSConditionalType") return 0;
  covered.add(node);

  return (
    1 +
    Math.max(conditionalDepth(node.trueType, covered), conditionalDepth(node.falseType, covered))
  );
}

/** The alias or interface a type sits in, for the message; nested object types included. */
function enclosingTypeName(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (NAMED_TYPE_DECLARATIONS.has(current.type)) return `Type ${current.id.name}`;
  }

  return "This type";
}

function conditionalTypeFinding(node, covered) {
  const depth = conditionalDepth(node, covered);
  if (depth <= MAX_CONDITIONAL_TYPE_DEPTH) return undefined;

  return {
    allowed: CONDITIONAL_TYPE_DEPTH_ALLOWED,
    message: `${enclosingTypeName(node)} nests ${depth} conditional types; the maximum is ${MAX_CONDITIONAL_TYPE_DEPTH}.`,
    node,
    policy: "conditional-type-depth",
  };
}

/** The name an overload declares, with `static ` in front of a static class member. */
function overloadName(node) {
  const declared = node.id ?? node.key;
  if (declared?.type !== "Identifier") return undefined;

  return node.static ? `static ${declared.name}` : declared.name;
}

/** The scope an overload set lives in: the program, a namespace, an interface or a class body. */
function overloadScope(node) {
  let scope = node.parent;
  while (scope && EXPORT_WRAPPERS.has(scope.type)) scope = scope.parent;

  return scope;
}

/** The literal-typed property names a signature's parameters mention. */
function booleanLiteralProperties(signature) {
  const found = new Map();
  for (const parameter of signature.params ?? signature.value?.params ?? []) {
    walk(parameter, (node) => {
      if (node.type !== "TSPropertySignature") return;
      if (node.key?.type !== "Identifier") return;
      const annotated = node.typeAnnotation?.typeAnnotation;
      if (annotated?.type !== "TSLiteralType") return;
      const literal = annotated.literal;
      if (literal?.type === "Literal" && typeof literal.value === "boolean") {
        found.set(node.key.name, literal.value);
      }
    });
  }

  return found;
}

/**
 * The declared type of a `private readonly x: T` field, or of a parameter
 * property in the constructor, as it is written in the source. Used to tell a
 * repository apart from another service.
 */
function fieldTypes(node, text) {
  const types = new Map();
  for (const [name, annotation] of (node.body?.body ?? []).flatMap(annotatedBindings)) {
    const declared = annotation?.typeAnnotation;
    if (declared && name?.type === "Identifier")
      types.set(name.name, text.slice(declared.start, declared.end));
  }

  return types;
}

/** A field's `[key, annotation]`, or a constructor's parameter properties as the same pairs. */
function annotatedBindings(member) {
  if (PROPERTY_MEMBERS.has(member.type)) return [[member.key, member.typeAnnotation]];
  if (member.type !== "MethodDefinition" || member.kind !== "constructor") return [];

  return (member.value?.params ?? []).map((parameter) => {
    const binding = parameter.type === "TSParameterProperty" ? parameter.parameter : parameter;
    return [binding, binding.typeAnnotation];
  });
}

/**
 * A service forwarding to its own repository is the layering rule working,
 * not a layer to delete: a transport may not touch a repository, so the
 * service has to publish those verbs.
 */
function forwardsToItsOwnRepository(receiver, types) {
  const root = receiver.split(".")[0];
  const declared = root === undefined ? undefined : types.get(root);

  return declared !== undefined && /Repository(Port)?$/.test(declared);
}

function layerClassFinding(node, text) {
  const methods = node.body?.body?.map(methodLike).filter((member) => member !== undefined) ?? [];
  if (methods.length < MIN_METHODS_FOR_LAYER) return undefined;

  const receivers = methods.map(delegationReceiver).filter((receiver) => receiver !== undefined);
  // Fanning out to several collaborators is composition: a class implementing
  // a published contract from specialist services. A pass-through layer
  // forwards everything to the same collaborator, and that is the one this
  // policy is looking for.
  const distinct = new Set(receivers);
  const types = fieldTypes(node, text);
  const toRepository = [...distinct].every((receiver) =>
    forwardsToItsOwnRepository(receiver, types),
  );
  if (receivers.length / methods.length < LAYER_DELEGATION_RATIO) return undefined;
  if (distinct.size > MAX_DELEGATION_RECEIVERS || toRepository) return undefined;

  return {
    allowed: LAYER_CLASS_ALLOWED,
    message: `${node.id?.name ?? "This class"} forwards ${receivers.length} of its ${methods.length} public methods to a method of the same name on \`this.${[...distinct].join("`, `this.")}\`.`,
    node,
    policy: "pass-through-class",
  };
}

function overloadByLiteralFinding(name, signatures) {
  if (signatures.length < 2) return undefined;

  const seen = new Map();
  for (const signature of signatures) {
    for (const [property, value] of booleanLiteralProperties(signature)) {
      const values = seen.get(property) ?? new Set();
      values.add(value);
      seen.set(property, values);
    }
  }
  for (const [property, values] of seen) {
    if (values.size < 2) continue;
    const [first] = signatures;
    if (!first) return undefined;

    return {
      allowed: OVERLOAD_BY_LITERAL_ALLOWED,
      message: `${name} carries overloads that differ only by \`${property}: true\` versus \`${property}: false\`.`,
      node: first,
      policy: "overload-by-literal",
    };
  }

  return undefined;
}

function layerFindingOf(node, { layersExempt, text }) {
  if (node.type !== "ClassDeclaration" || layersExempt) return undefined;

  return layerClassFinding(node, text);
}

function conditionalFindingOf(node, covered) {
  if (node.type !== "TSConditionalType" || covered.has(node)) return undefined;

  return conditionalTypeFinding(node, covered);
}

/** Files an overloadable declaration under its scope and name, so only true siblings group. */
function recordOverload(overloads, node) {
  const name = OVERLOADABLE.has(node.type) ? overloadName(node) : undefined;
  if (name === undefined) return;
  const scope = overloadScope(node);
  const byName = overloads.get(scope) ?? new Map();
  byName.set(name, [...(byName.get(name) ?? []), node]);
  overloads.set(scope, byName);
}

/**
 * Every over-abstraction finding in one file, as `{ policy, node, message,
 * allowed }`, from one walk; `path` is read only for the layer exemptions.
 * @param {{ path: string, program: object, text: string }} file
 */
export function overengineeringFindings({ path, program, text }) {
  const findings = [];
  const overloads = new Map();
  const covered = new WeakSet();
  const layersExempt = isExemptFromLayerRule(path);

  walk(program, (node) => {
    const finding =
      layerFindingOf(node, { layersExempt, text }) ?? conditionalFindingOf(node, covered);
    if (finding) findings.push(finding);
    recordOverload(overloads, node);
  });

  for (const [name, signatures] of [...overloads.values()].flatMap((byName) => [...byName])) {
    const finding = overloadByLiteralFinding(name.replace(/^static /, ""), signatures);
    if (finding) findings.push(finding);
  }

  return findings;
}
