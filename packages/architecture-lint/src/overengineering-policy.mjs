import ts from "typescript";

// The three over-abstraction detectors, as one pure per-file function.
//
// The oxlint rules `layer-class`, `overload-by-literal` and
// `conditional-type-depth` report what this returns; the CLI calls the same
// function to tell a stale `overengineering-baseline.json` entry from a live
// one. There is one implementation, and it lives here.

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

function lineOf(source, node) {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

function isPrivate(member) {
  const modifiers = ts.canHaveModifiers(member) ? (ts.getModifiers(member) ?? []) : [];
  return modifiers.some(
    (modifier) =>
      modifier.kind === ts.SyntaxKind.PrivateKeyword ||
      modifier.kind === ts.SyntaxKind.ProtectedKeyword,
  );
}

/**
 * A class member that behaves like a method: a method declaration, or a
 * property initialised with an arrow. Facades that bind `this` by field are
 * written the second way, and counting only the first missed two governance
 * layers of 99 delegations each.
 */
function methodLike(member) {
  if (!member.name || !ts.isIdentifier(member.name)) return undefined;
  if (isPrivate(member)) return undefined;
  if (ts.isMethodDeclaration(member)) {
    return member.body
      ? { name: member.name.text, body: member.body, declaration: member }
      : undefined;
  }
  if (ts.isPropertyDeclaration(member) && member.initializer) {
    const initializer = member.initializer;
    return ts.isArrowFunction(initializer)
      ? { name: member.name.text, body: initializer.body, declaration: member }
      : undefined;
  }
  return undefined;
}

function parametersOf(member) {
  const declaration = member.declaration;
  if (ts.isMethodDeclaration(declaration)) return declaration.parameters;
  if (
    ts.isPropertyDeclaration(declaration) &&
    declaration.initializer &&
    (ts.isArrowFunction(declaration.initializer) ||
      ts.isFunctionExpression(declaration.initializer))
  ) {
    return declaration.initializer.parameters;
  }

  return [];
}

/**
 * Whether the forward reshapes what it was given on the way through. A hop
 * that hands its own parameters straight on is what this policy is about;
 * anything that is not plainly a parameter or a spread counts as a transform.
 */
function transformsItsArguments(member, call) {
  const parameters = new Set(
    parametersOf(member)
      .map((parameter) => parameter.name)
      .filter((name) => ts.isIdentifier(name))
      .map((name) => name.text),
  );

  return call.arguments.some(
    (argument) =>
      !ts.isSpreadElement(argument) &&
      !(ts.isIdentifier(argument) && parameters.has(argument.text)),
  );
}

/**
 * The receiver of a same-name delegation, as a dotted path, or undefined when
 * the body is anything else. The body must be nothing but
 * `this.<a>.<b>...<name>(...)`; `await` in front counts, a guard does not.
 */
function delegationReceiver(member) {
  const { name, body } = member;
  if (!body) return undefined;

  let expression;
  if (ts.isBlock(body)) {
    const statements = body.statements;
    if (statements.length !== 1) return undefined;
    const [only] = statements;
    if (!only || !ts.isReturnStatement(only) || !only.expression) return undefined;
    expression = only.expression;
  } else {
    expression = body;
  }
  if (ts.isAwaitExpression(expression)) expression = expression.expression;
  if (!ts.isCallExpression(expression)) return undefined;

  const callee = expression.expression;
  if (!ts.isPropertyAccessExpression(callee)) return undefined;
  if (callee.name.text !== name) return undefined;
  if (transformsItsArguments(member, expression)) return undefined;

  // The receiver must be a `this.…` chain, not a free function or an import.
  const path = [];
  let receiver = callee.expression;
  while (ts.isPropertyAccessExpression(receiver)) {
    path.unshift(receiver.name.text);
    receiver = receiver.expression;
  }
  if (receiver.kind !== ts.SyntaxKind.ThisKeyword) return undefined;
  return path.join(".");
}

function conditionalDepth(node) {
  if (!ts.isConditionalTypeNode(node)) return 0;
  return 1 + Math.max(conditionalDepth(node.trueType), conditionalDepth(node.falseType));
}

/** The literal-typed property names a signature's parameters mention. */
function booleanLiteralProperties(signature) {
  const found = new Map();
  const visit = (node) => {
    if (ts.isPropertySignature(node) && node.type && ts.isIdentifier(node.name)) {
      if (node.type.kind === ts.SyntaxKind.LiteralType) {
        const literal = node.type.literal;
        if (literal.kind === ts.SyntaxKind.TrueKeyword) found.set(node.name.text, true);
        if (literal.kind === ts.SyntaxKind.FalseKeyword) found.set(node.name.text, false);
      }
    }
    ts.forEachChild(node, visit);
  };
  for (const parameter of signature.parameters) visit(parameter);
  return found;
}

/**
 * The declared type of a `private readonly x: T` field, or of a parameter
 * property in the constructor. Used to tell a repository apart from another
 * service.
 */
function fieldTypes(node) {
  const types = new Map();
  const record = (name, type) => {
    if (!type || !ts.isIdentifier(name)) return;
    types.set(name.text, type.getText());
  };
  for (const member of node.members) {
    if (ts.isPropertyDeclaration(member) && member.name) record(member.name, member.type);
    if (ts.isConstructorDeclaration(member)) {
      for (const parameter of member.parameters) record(parameter.name, parameter.type);
    }
  }
  return types;
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

/**
 * Every over-abstraction finding in one file, as `{ policy, line, message,
 * allowed }`. `path` is only read for the layer-rule exemptions.
 */
export function overengineeringFindings({ path, source: text }) {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const findings = [];
  const overloads = new Map();

  const visit = (node) => {
    if (ts.isClassDeclaration(node) && !isExemptFromLayerRule(path)) {
      const methods = node.members.map(methodLike).filter((member) => member !== undefined);
      if (methods.length >= MIN_METHODS_FOR_LAYER) {
        const receivers = methods
          .map(delegationReceiver)
          .filter((receiver) => receiver !== undefined);
        const ratio = receivers.length / methods.length;
        // Fanning out to several collaborators is composition: a class
        // implementing a published contract from specialist services. A
        // pass-through layer forwards everything to the same collaborator,
        // and that is the one this policy is looking for.
        const distinct = new Set(receivers);
        const types = fieldTypes(node);
        const toRepository = [...distinct].every((receiver) =>
          forwardsToItsOwnRepository(receiver, types),
        );
        if (
          ratio >= LAYER_DELEGATION_RATIO &&
          distinct.size <= MAX_DELEGATION_RECEIVERS &&
          !toRepository
        ) {
          findings.push({
            policy: "layer-class",
            line: lineOf(source, node),
            message: `${node.name?.text ?? "This class"} forwards ${receivers.length} of its ${methods.length} public methods to a method of the same name on \`this.${[...distinct].join("`, `this.")}\`.`,
            allowed: LAYER_CLASS_ALLOWED,
          });
        }
      }
    }

    if (ts.isTypeAliasDeclaration(node)) {
      const depth = conditionalDepth(node.type);
      if (depth > MAX_CONDITIONAL_TYPE_DEPTH) {
        findings.push({
          policy: "conditional-type-depth",
          line: lineOf(source, node),
          message: `Type ${node.name.text} nests ${depth} conditional types; the maximum is ${MAX_CONDITIONAL_TYPE_DEPTH}.`,
          allowed: CONDITIONAL_TYPE_DEPTH_ALLOWED,
        });
      }
    }

    if (
      (ts.isFunctionDeclaration(node) || ts.isMethodSignature(node)) &&
      node.name &&
      ts.isIdentifier(node.name)
    ) {
      const list = overloads.get(node.name.text) ?? [];
      list.push(node);
      overloads.set(node.name.text, list);
    }

    ts.forEachChild(node, visit);
  };
  visit(source);

  for (const [name, signatures] of overloads) {
    if (signatures.length < 2) continue;
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
      const first = signatures[0];
      if (!first) continue;
      findings.push({
        policy: "overload-by-literal",
        line: lineOf(source, first),
        message: `${name} carries overloads that differ only by \`${property}: true\` versus \`${property}: false\`.`,
        allowed: OVERLOAD_BY_LITERAL_ALLOWED,
      });
      break;
    }
  }

  return findings;
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
