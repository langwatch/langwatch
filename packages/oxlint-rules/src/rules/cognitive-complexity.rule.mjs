import { childNodes } from "../ast.mjs";
import { isBaselined } from "../baseline.mjs";
import { defineRule } from "../define-rule.mjs";

// SonarSource cognitive complexity: a structural +1 per control-flow break,
// plus the current nesting level for the constructs that nest. `else` and
// `else if` take the +1 without the nesting penalty, boolean sequences and
// recursion take +1 flat, and a nested function raises the nesting level for
// everything inside it.
const COGNITIVE_FUNCTION_TYPES = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
]);

function isLogicalSequence(node) {
  return node.type === "LogicalExpression" && (node.operator === "&&" || node.operator === "||");
}

function isNestedFunction(node) {
  let current = node.parent;
  while (current) {
    if (COGNITIVE_FUNCTION_TYPES.has(current.type)) return true;
    current = current.parent;
  }
  return false;
}

function functionName(node) {
  if (node.id?.name) return node.id.name;
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

function isRecursiveCall(node, name) {
  if (!name) return false;
  const callee = node.callee;
  if (!callee) return false;
  if (callee.type === "Identifier") return callee.name === name;
  return (
    callee.type === "MemberExpression" &&
    !callee.computed &&
    callee.object?.type === "ThisExpression" &&
    callee.property?.type === "Identifier" &&
    callee.property.name === name
  );
}

// Human label for the single construct the message points at, so the fix
// names a concrete extraction target instead of just the function.
const CONSTRUCT_LABELS = {
  IfStatement: "if statement",
  ConditionalExpression: "ternary expression",
  SwitchStatement: "switch statement",
  ForStatement: "for loop",
  ForInStatement: "for-in loop",
  ForOfStatement: "for-of loop",
  WhileStatement: "while loop",
  DoWhileStatement: "do-while loop",
  CatchClause: "catch block",
  LogicalExpression: "chained boolean condition",
  BreakStatement: "labeled break",
  ContinueStatement: "labeled continue",
  CallExpression: "recursive call",
};

function describeConstruct(node) {
  return CONSTRUCT_LABELS[node.type] ?? "construct";
}

export function cognitiveComplexity(functionNode) {
  let score = 0;
  // The single construct that added the most to the score, so the report can
  // point at one concrete extraction target instead of just the function.
  let heaviest;
  const note = (node, delta) => {
    score += delta;
    if (!heaviest || delta > heaviest.delta) heaviest = { delta, node };
  };

  const walkIf = (node, nesting, isElseIf, owner) => {
    note(node, isElseIf ? 1 : 1 + nesting);
    walk(node.test, nesting, owner);
    walk(node.consequent, nesting + 1, owner);
    const alternate = node.alternate;
    if (!alternate) return;
    if (alternate.type === "IfStatement") {
      walkIf(alternate, nesting, true, owner);
      return;
    }
    note(node, 1);
    walk(alternate, nesting + 1, owner);
  };

  const walkChildren = (node, nesting, owner) => {
    for (const child of childNodes(node)) walk(child, nesting, owner);
  };

  const walkNested = (node, nesting, owner, bodyNesting) => {
    for (const child of childNodes(node)) {
      walk(child, child === node.body ? bodyNesting : nesting, owner);
    }
  };

  function walk(node, nesting, owner) {
    if (!node) return;
    switch (node.type) {
      case "IfStatement":
        walkIf(node, nesting, false, owner);
        return;
      case "ConditionalExpression":
        note(node, 1 + nesting);
        walk(node.test, nesting, owner);
        walk(node.consequent, nesting + 1, owner);
        walk(node.alternate, nesting + 1, owner);
        return;
      case "SwitchStatement":
        note(node, 1 + nesting);
        walk(node.discriminant, nesting, owner);
        for (const switchCase of node.cases) walk(switchCase, nesting + 1, owner);
        return;
      case "ForStatement":
      case "ForInStatement":
      case "ForOfStatement":
      case "WhileStatement":
      case "DoWhileStatement":
        note(node, 1 + nesting);
        walkNested(node, nesting, owner, nesting + 1);
        return;
      case "CatchClause":
        note(node, 1 + nesting);
        walkNested(node, nesting, owner, nesting + 1);
        return;
      case "LogicalExpression": {
        if (!isLogicalSequence(node)) break;
        const operators = [];
        const leaves = [];
        const flatten = (current) => {
          if (!isLogicalSequence(current)) {
            leaves.push(current);
            return;
          }
          flatten(current.left);
          operators.push(current.operator);
          flatten(current.right);
        };
        flatten(node);
        let sequences = 1;
        for (let index = 1; index < operators.length; index += 1) {
          if (operators[index] !== operators[index - 1]) sequences += 1;
        }
        note(node, sequences);
        for (const leaf of leaves) walk(leaf, nesting, owner);
        return;
      }
      case "BreakStatement":
      case "ContinueStatement":
        if (node.label) note(node, 1);
        return;
      case "CallExpression":
        if (isRecursiveCall(node, owner)) note(node, 1);
        break;
      case "FunctionDeclaration":
      case "FunctionExpression":
      case "ArrowFunctionExpression":
        walkNested(node, nesting, functionName(node) ?? owner, nesting + 1);
        return;
      default:
        break;
    }
    walkChildren(node, nesting, owner);
  }

  walkNested(functionNode, 0, functionName(functionNode), 0);
  return { heaviest, score };
}

export const cognitiveComplexityRule = defineRule({
  name: "cognitive-complexity",
  kind: "problem",
  options: {
    max: { type: "integer", minimum: 0, default: 15 },
  },
  messages: {
    tooComplex: {
      what: "`{{name}}` has cognitive complexity {{complexity}} (max {{max}}); the heaviest contributor is the {{construct}} at line {{atLine}}.",
      fix: "Extract that {{construct}} into its own named function so the rest of `{{name}}` stays flat.",
    },
  },
  create(context, file, { max }) {
    const check = (node) => {
      if (isNestedFunction(node)) return;
      if (
        isBaselined({ cwd: context.cwd, file: file.workspacePath, rule: "cognitive-complexity" })
      ) {
        return;
      }
      const { heaviest, score: complexity } = cognitiveComplexity(node);
      if (complexity <= max) return;
      context.report({
        node,
        messageId: "tooComplex",
        data: {
          atLine: heaviest?.node?.loc?.start?.line ?? "?",
          complexity,
          construct: heaviest ? describeConstruct(heaviest.node) : "construct",
          max,
          name: functionName(node) ?? "This function",
        },
      });
    };

    return {
      FunctionDeclaration: check,
      FunctionExpression: check,
      ArrowFunctionExpression: check,
    };
  },
});
