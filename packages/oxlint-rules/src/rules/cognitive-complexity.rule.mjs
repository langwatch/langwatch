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

// Human label for the block the message points at, so the fix names a
// concrete extraction target instead of just the function.
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
  if (node.type === "IfStatement" && node.alternate) return "if/else chain";
  return CONSTRUCT_LABELS[node.type] ?? "construct";
}

export function cognitiveComplexity(functionNode) {
  let score = 0;
  // Attribution is by the weight of a whole BLOCK, not by the single node
  // with the largest delta. Those are different questions, and the second
  // one answers badly: a function whose score is nesting spread over a
  // dozen constructs has many nodes tied at the top, so "heaviest" became
  // whichever the walk reached first. That named leaves no one should
  // extract -- a `spent ? null : approval` ternary carrying 3 of 25 was
  // reported as the reason for the whole score, while the catch block
  // carrying 11 went unmentioned. A block is the thing a reader can lift
  // out, so a block is what gets measured and named.
  const blocks = [];
  const open = [];
  const note = (node, delta) => {
    score += delta;
    for (const block of open) block.subtotal += delta;
  };
  // Every nesting construct opens a block that accumulates what its subtree
  // scores, itself included -- so `enter` wraps the construct's own `note`.
  const enter = (node) => {
    const block = { node, subtotal: 0 };
    blocks.push(block);
    open.push(block);
    return block;
  };
  const leave = () => open.pop();

  // An `else if` continues the chain its head opened rather than opening one
  // of its own: the reader extracts the whole chain or none of it.
  const walkIf = (node, nesting, isElseIf, owner) => {
    if (!isElseIf) enter(node);
    note(node, isElseIf ? 1 : 1 + nesting);
    walk(node.test, nesting, owner);
    walk(node.consequent, nesting + 1, owner);
    const alternate = node.alternate;
    if (!alternate) {
      if (!isElseIf) leave();
      return;
    }
    if (alternate.type === "IfStatement") {
      walkIf(alternate, nesting, true, owner);
      if (!isElseIf) leave();
      return;
    }
    note(node, 1);
    walk(alternate, nesting + 1, owner);
    if (!isElseIf) leave();
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
        enter(node);
        note(node, 1 + nesting);
        walk(node.test, nesting, owner);
        walk(node.consequent, nesting + 1, owner);
        walk(node.alternate, nesting + 1, owner);
        leave();
        return;
      case "SwitchStatement":
        enter(node);
        note(node, 1 + nesting);
        walk(node.discriminant, nesting, owner);
        for (const switchCase of node.cases) walk(switchCase, nesting + 1, owner);
        leave();
        return;
      case "ForStatement":
      case "ForInStatement":
      case "ForOfStatement":
      case "WhileStatement":
      case "DoWhileStatement":
        enter(node);
        note(node, 1 + nesting);
        walkNested(node, nesting, owner, nesting + 1);
        leave();
        return;
      case "CatchClause":
        enter(node);
        note(node, 1 + nesting);
        walkNested(node, nesting, owner, nesting + 1);
        leave();
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

  // A block that accounts for the entire score has nothing outside it, so
  // extracting it is just renaming the function -- never useful advice.
  // Among the rest the largest wins; ties go to the one a reader meets
  // first. When even the winner carries less than a third, the score is
  // genuinely spread and the report says so instead of inventing a target.
  const extractable = blocks.filter((block) => block.subtotal < score);
  let heaviest;
  for (const block of extractable) {
    if (!heaviest || block.subtotal > heaviest.subtotal) heaviest = block;
  }
  const concentrated = Boolean(heaviest) && heaviest.subtotal * 3 >= score;
  return { blocks, concentrated, heaviest, score };
}

export const cognitiveComplexityRule = defineRule({
  name: "cognitive-complexity",
  kind: "problem",
  options: {
    max: { type: "integer", minimum: 0, default: 15 },
  },
  messages: {
    tooComplex: {
      what: "`{{name}}` has cognitive complexity {{complexity}} (max {{max}}); the {{construct}} at line {{atLine}} carries {{share}} of it.",
      fix: "Extract that {{construct}} into its own named function so the rest of `{{name}}` stays flat.",
    },
    // The score is nesting spread thin rather than one heavy block. Naming a
    // block here would prescribe an extraction that removes a few points and
    // leaves the shape untouched, so the report asks for the thing that
    // actually pays: fewer levels.
    tooComplexSpread: {
      what: "`{{name}}` has cognitive complexity {{complexity}} (max {{max}}), spread across {{blocks}} nested blocks with no single one carrying a third of it -- the depth is the cost, not any one branch.",
      fix: "Flatten it: take the nesting down with early returns, or lift a whole stage of the work -- the {{construct}} at line {{atLine}} is the largest single block at {{share}} -- into its own named function.",
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
      const { blocks, concentrated, heaviest, score: complexity } = cognitiveComplexity(node);
      if (complexity <= max) return;
      context.report({
        node,
        messageId: concentrated ? "tooComplex" : "tooComplexSpread",
        data: {
          atLine: heaviest?.node?.loc?.start?.line ?? "?",
          blocks: blocks.length,
          complexity,
          construct: heaviest ? describeConstruct(heaviest.node) : "construct",
          max,
          name: functionName(node) ?? "This function",
          share: heaviest ? `${heaviest.subtotal} of ${complexity}` : "an unclear share",
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
