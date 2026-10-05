import { defineRule } from "../define-rule.mjs";

// SonarSource cognitive complexity: a structural +1 per control-flow break,
// plus the current nesting level for the constructs that nest. `else` and
// `else if` take the +1 without the nesting penalty, boolean sequences and
// recursion take +1 flat, and a nested function raises the nesting level for
// everything inside it.
function isLogicalSequence(node) {
  return node.type === "LogicalExpression" && (node.operator === "&&" || node.operator === "||");
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
function sequencesIn(node) {
  const { operators } = flattenLogical(node);

  return operators.filter((operator, index) => index === 0 || operator !== operators[index - 1])
    .length;
}

const RANGE_OF = (node) => ({ start: node.start, end: node.end });

/** The parts of a construct that sit one level deeper; the rest of it scores at its own level. */
const NESTED_SLOTS = {
  CatchClause: (node) => [node.body],
  ConditionalExpression: (node) => [node.consequent, node.alternate],
  DoWhileStatement: (node) => [node.body],
  ForInStatement: (node) => [node.body],
  ForOfStatement: (node) => [node.body],
  ForStatement: (node) => [node.body],
  IfStatement: (node) => [
    node.consequent,
    node.alternate?.type === "IfStatement" ? null : node.alternate,
  ],
  SwitchStatement: (node) =>
    node.cases.length > 0 ? [{ start: node.cases[0].start, end: node.end }] : [],
  WhileStatement: (node) => [node.body],
};

/** Constructs that score 1 plus their nesting and open a block a reader can lift out. */
const BLOCK_TYPES = new Set(Object.keys(NESTED_SLOTS));

function slotsOf(node) {
  const slots = [];
  for (const slot of NESTED_SLOTS[node.type](node)) if (slot) slots.push(RANGE_OF(slot));

  return slots;
}

/**
 * Scores one outermost function as the linter's traversal passes through it. Nesting is the
 * number of open constructs whose nested part contains the node; a block stays open while the
 * traversal is inside its range, so a note reaches every block around it.
 */
function createTally() {
  return { blocks: [], frames: [], open: [], owners: [], score: 0, top: undefined };
}

function nestingAt(tally, node) {
  let nesting = 0;
  for (const frame of tally.frames) {
    if (frame.slots.some((slot) => slot.start <= node.start && node.end <= slot.end)) nesting += 1;
  }

  return nesting;
}

function note(tally, delta) {
  tally.score += delta;
  for (const block of tally.open) block.subtotal += delta;
}

function scoreConstruct(tally, node) {
  const isElseIf =
    node.type === "IfStatement" &&
    node.parent?.type === "IfStatement" &&
    node.parent.alternate === node;
  if (BLOCK_TYPES.has(node.type) && !isElseIf) {
    const block = { node, subtotal: 0 };
    tally.blocks.push(block);
    tally.open.push(block);
  }
  const nesting = nestingAt(tally, node);
  let delta = isElseIf ? 1 : 1 + nesting;
  if (node.type === "IfStatement" && node.alternate && node.alternate.type !== "IfStatement")
    delta += 1;
  note(tally, delta);
  tally.frames.push({ end: node.end, slots: slotsOf(node) });
}

function scoreOther(tally, node) {
  if (node.type === "LogicalExpression") {
    const parentIsSequence = node.parent && isLogicalSequence(node.parent);
    if (isLogicalSequence(node) && !parentIsSequence) note(tally, sequencesIn(node));
  } else if (node.type === "BreakStatement" || node.type === "ContinueStatement") {
    if (node.label) note(tally, 1);
  } else if (isRecursiveCall(node, tally.owners.at(-1))) {
    note(tally, 1);
  }
}

function prune(tally, node) {
  const { open } = tally;
  while (open.length > 0 && open.at(-1).node.end <= node.start) open.pop();
  tally.frames = tally.frames.filter((frame) => frame.end > node.start);
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

/** Reports the function the tally just closed, when its score is over `max`. */
function reportTooComplex({ context, max, node, tally }) {
  const { blocks, score: complexity } = tally;
  if (complexity <= max) return;
  const heaviest = heaviestExtractable(blocks, complexity);
  // Under a third of the score, the report says "spread" rather than invent a target.
  const concentrated = Boolean(heaviest) && heaviest.subtotal * 3 >= complexity;
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
    const tally = createTally();

    const report = (node) => reportTooComplex({ context, max, node, tally });
    const enterFunction = (node) => {
      const owner = functionName(node) ?? tally.owners.at(-1);
      if (tally.top) {
        prune(tally, node);
        tally.frames.push({ end: node.end, slots: [RANGE_OF(node.body)] });
      } else {
        Object.assign(tally, createTally(), { top: node });
      }
      tally.owners.push(owner);
    };
    const exitFunction = (node) => {
      tally.owners.pop();
      if (tally.top !== node) return;
      report(node);
      tally.top = undefined;
    };
    const scored = (score) => (node) => {
      if (!tally.top) return;
      prune(tally, node);
      score(tally, node);
    };

    return {
      ArrowFunctionExpression: enterFunction,
      "ArrowFunctionExpression:exit": exitFunction,
      BreakStatement: scored(scoreOther),
      CallExpression: scored(scoreOther),
      CatchClause: scored(scoreConstruct),
      ConditionalExpression: scored(scoreConstruct),
      ContinueStatement: scored(scoreOther),
      DoWhileStatement: scored(scoreConstruct),
      ForInStatement: scored(scoreConstruct),
      ForOfStatement: scored(scoreConstruct),
      ForStatement: scored(scoreConstruct),
      FunctionDeclaration: enterFunction,
      "FunctionDeclaration:exit": exitFunction,
      FunctionExpression: enterFunction,
      "FunctionExpression:exit": exitFunction,
      IfStatement: scored(scoreConstruct),
      LogicalExpression: scored(scoreOther),
      SwitchStatement: scored(scoreConstruct),
      WhileStatement: scored(scoreConstruct),
    };
  },
});
