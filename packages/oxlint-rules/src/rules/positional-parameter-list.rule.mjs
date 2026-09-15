import { defineRule } from "../define-rule.mjs";

// CLAUDE.md: a multi-argument function takes named parameters via object
// destructuring (`fn({ a, b })`), not a positional list the caller has to
// count to get right. A constructor is exempt — house DI takes its
// collaborators positionally — and so is a function whose arity the callee
// dictates (an array-callback, a Hono handler passed to `.use()`, anything
// handed straight to a call). An overload signature is exempt in favour of
// the implementation it describes: a bodyless class-method overload
// (`TSEmptyBodyFunctionExpression`) is skipped and its `FunctionExpression`
// implementation reported instead, and a free-function overload
// (`TSDeclareFunction`) is never visited at all.

const GOVERNED = /^(?:enterprise\/modules|modules|apps|packages)\//;

function isGovernedSource(file) {
  return GOVERNED.test(file.workspacePath);
}

function isCallArgumentPosition(node) {
  const parent = node.parent;
  return (
    (parent?.type === "CallExpression" || parent?.type === "NewExpression") &&
    parent.arguments.includes(node)
  );
}

/** Declaration id, enclosing declarator, or method/property key; `undefined` if none apply. */
function functionName(node) {
  if (node.id?.type === "Identifier") return node.id.name;
  const owner = node.parent;
  if (!owner) return undefined;
  if (owner.type === "VariableDeclarator" && owner.id?.type === "Identifier") return owner.id.name;
  if (
    (owner.type === "MethodDefinition" || owner.type === "PropertyDefinition") &&
    owner.key?.type === "Identifier"
  ) {
    return owner.key.name;
  }
  if (owner.type === "Property" && owner.key?.type === "Identifier") return owner.key.name;
  return undefined;
}

function keyName(node) {
  return node.key?.type === "Identifier" ? node.key.name : undefined;
}

/**
 * Params minus a lone trailing rest parameter: a rest absorbs variadic input
 * rather than adding one more slot to a fixed positional list.
 */
function positionalCount(params) {
  if (params.length === 0) return 0;
  const last = params[params.length - 1];
  return last.type === "RestElement" ? params.length - 1 : params.length;
}

export const positionalParameterListRule = defineRule({
  name: "positional-parameter-list",
  kind: "problem",
  applies: (file) => file.isProduction && isGovernedSource(file),
  options: {
    max: { type: "integer", minimum: 2, default: 3 },
  },
  messages: {
    tooManyPositionalParameters: {
      what: "`{{name}}` takes {{count}} positional parameters.",
      fix: "Gather them into a single options object parameter with named fields.",
    },
  },
  create(context, _file, { max }) {
    const report = (node, name, count) => {
      context.report({
        node,
        messageId: "tooManyPositionalParameters",
        data: { count, max, name: name ?? "this function" },
      });
    };

    const checkFunction = (node) => {
      if (isCallArgumentPosition(node)) return;
      const count = positionalCount(node.params);
      if (count <= max) return;
      report(node, functionName(node), count);
    };

    return {
      FunctionDeclaration: checkFunction,
      FunctionExpression(node) {
        // A class method's value is checked via `MethodDefinition` below, with
        // the bodyless-overload skip that lives there; visiting it again here
        // would double-report the implementation.
        if (node.parent?.type === "MethodDefinition") return;
        checkFunction(node);
      },
      ArrowFunctionExpression: checkFunction,
      MethodDefinition(node) {
        if (node.kind === "constructor") return;
        // A bodyless overload signature inside a class parses as a
        // `MethodDefinition` whose value has no body; only its implementation
        // (a real `FunctionExpression`) is reported.
        if (node.value?.type !== "FunctionExpression") return;
        const count = positionalCount(node.value.params);
        if (count <= max) return;
        report(node.value, functionName(node.value) ?? keyName(node), count);
      },
      TSMethodSignature(node) {
        const count = positionalCount(node.params);
        if (count <= max) return;
        report(node, keyName(node), count);
      },
    };
  },
});
