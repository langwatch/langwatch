import { childNodes } from "../ast.mjs";
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

// Attribution is by the weight of a whole block, not the single node with the
// largest delta: a block is the thing a reader can lift out.
function note(tally, delta) {
  tally.score += delta;
  for (const block of tally.open) block.subtotal += delta;
}

function enter(tally, node) {
  const block = { node, subtotal: 0 };
  tally.blocks.push(block);
  tally.open.push(block);
}

function leave(tally) {
  tally.open.pop();
}

function walkNested(tally, node, { bodyNesting, nesting, owner }) {
  for (const child of childNodes(node)) {
    walkNode(tally, child, { nesting: child === node.body ? bodyNesting : nesting, owner });
  }
}

// An `else if` continues the chain its head opened: the reader extracts all of it or none.
function walkIf(tally, node, { isElseIf, nesting, owner }) {
  if (!isElseIf) enter(tally, node);
  note(tally, isElseIf ? 1 : 1 + nesting);
  walkNode(tally, node.test, { nesting, owner });
  walkNode(tally, node.consequent, { nesting: nesting + 1, owner });
  walkElse(tally, node.alternate, { nesting, owner });
  if (!isElseIf) leave(tally);

  return true;
}

function walkElse(tally, alternate, { nesting, owner }) {
  if (!alternate) return;
  if (alternate.type === "IfStatement") {
    walkIf(tally, alternate, { isElseIf: true, nesting, owner });
    return;
  }
  note(tally, 1);
  walkNode(tally, alternate, { nesting: nesting + 1, owner });
}

function walkConditional(tally, node, { nesting, owner }) {
  enter(tally, node);
  note(tally, 1 + nesting);
  walkNode(tally, node.test, { nesting, owner });
  walkNode(tally, node.consequent, { nesting: nesting + 1, owner });
  walkNode(tally, node.alternate, { nesting: nesting + 1, owner });
  leave(tally);

  return true;
}

function walkSwitch(tally, node, { nesting, owner }) {
  enter(tally, node);
  note(tally, 1 + nesting);
  walkNode(tally, node.discriminant, { nesting, owner });
  for (const switchCase of node.cases) walkNode(tally, switchCase, { nesting: nesting + 1, owner });
  leave(tally);

  return true;
}

/** A loop or a catch: the construct scores, and only its body nests one deeper. */
function walkLoop(tally, node, { nesting, owner }) {
  enter(tally, node);
  note(tally, 1 + nesting);
  walkNested(tally, node, { bodyNesting: nesting + 1, nesting, owner });
  leave(tally);

  return true;
}

function flattenLogical(node, into = { leaves: [], operators: [] }) {
  if (!isLogicalSequence(node)) {
    into.leaves.push(node);
    return into;
  }
  flattenLogical(node.left, into);
  into.operators.push(node.operator);
  flattenLogical(node.right, into);

  return into;
}

/** `a && b && c || d` is two sequences: +1 per run of one operator. */
function walkLogical(tally, node, { nesting, owner }) {
  if (!isLogicalSequence(node)) return false;
  const { leaves, operators } = flattenLogical(node);
  const sequences = operators.filter(
    (operator, index) => index === 0 || operator !== operators[index - 1],
  );
  note(tally, sequences.length);
  for (const leaf of leaves) walkNode(tally, leaf, { nesting, owner });

  return true;
}

function walkJump(tally, node) {
  if (node.label) note(tally, 1);

  return true;
}

function walkFunction(tally, node, { nesting, owner }) {
  walkNested(tally, node, {
    bodyNesting: nesting + 1,
    nesting,
    owner: functionName(node) ?? owner,
  });

  return true;
}

const WALKERS = {
  ArrowFunctionExpression: walkFunction,
  BreakStatement: walkJump,
  CatchClause: walkLoop,
  ConditionalExpression: walkConditional,
  ContinueStatement: walkJump,
  DoWhileStatement: walkLoop,
  ForInStatement: walkLoop,
  ForOfStatement: walkLoop,
  ForStatement: walkLoop,
  FunctionDeclaration: walkFunction,
  FunctionExpression: walkFunction,
  IfStatement: (tally, node, where) => walkIf(tally, node, { ...where, isElseIf: false }),
  LogicalExpression: walkLogical,
  SwitchStatement: walkSwitch,
  WhileStatement: walkLoop,
};

/** Scores `node`; a walker that returns true has already walked the subtree. */
function walkNode(tally, node, where) {
  if (!node) return;
  const walker = Object.hasOwn(WALKERS, node.type) ? WALKERS[node.type] : undefined;
  if (walker?.(tally, node, where)) return;
  if (node.type === "CallExpression" && isRecursiveCall(node, where.owner)) note(tally, 1);
  for (const child of childNodes(node)) walkNode(tally, child, where);
}

/** The largest block that leaves something outside it; ties go to the one met first. */
function heaviestExtractable(blocks, score) {
  let heaviest;
  for (const block of blocks) {
    if (block.subtotal < score && (!heaviest || block.subtotal > heaviest.subtotal))
      heaviest = block;
  }

  return heaviest;
}

export function cognitiveComplexity(functionNode) {
  const tally = { blocks: [], open: [], score: 0 };
  walkNested(tally, functionNode, {
    bodyNesting: 0,
    nesting: 0,
    owner: functionName(functionNode),
  });
  const { blocks, score } = tally;
  const heaviest = heaviestExtractable(blocks, score);
  // Under a third of the score, the report says "spread" rather than invent a target.
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
      fix: "Extract that {{construct}} into a module-level function (a nested closure still counts toward `{{name}}`) so the rest of `{{name}}` stays flat.",
    },
    // The score is nesting spread thin rather than one heavy block. Naming a
    // block here would prescribe an extraction that removes a few points and
    // leaves the shape untouched, so the report asks for the thing that
    // actually pays: fewer levels.
    tooComplexSpread: {
      what: "`{{name}}` has cognitive complexity {{complexity}} (max {{max}}), spread across {{blocks}} nested blocks with no single one carrying a third of it -- the depth is the cost, not any one branch.",
      fix: "Flatten it: take the nesting down with early returns, or lift a whole stage of the work -- the {{construct}} at line {{atLine}} is the largest single block at {{share}} -- into a module-level function; a nested closure still counts toward `{{name}}`.",
    },
  },
  create(context, file, { max }) {
    const check = (node) => {
      if (isNestedFunction(node)) return;
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
