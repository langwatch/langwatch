import { defineRule } from "../define-rule.mjs";

// A condition is readable at a glance or it is named. Each exceeded limit is
// its own report: calls, logical operators, a ternary in the test, and chain
// depth, which counts only once the test already calls or combines.

const CONDITION_LOGICAL_OPERATORS = new Set(["&&", "||", "??"]);

function chainDepth(node) {
  if (!node) return 0;
  if (node.type === "MemberExpression" || node.type === "OptionalMemberExpression") {
    return 1 + chainDepth(node.object);
  }
  if (node.type === "CallExpression" || node.type === "OptionalCallExpression") {
    return chainDepth(node.callee);
  }
  if (node.type === "ChainExpression" || node.type === "TSNonNullExpression") {
    return chainDepth(node.expression);
  }

  return 0;
}

const MEASURED_TYPES = {
  ConditionalExpression: (shape) => {
    shape.nestedTernary = true;
  },
  CallExpression: (shape) => {
    shape.calls += 1;
  },
  LogicalExpression: (shape, node) => {
    if (CONDITION_LOGICAL_OPERATORS.has(node.operator)) shape.operators += 1;
  },
  MemberExpression: (shape, node) => {
    shape.hops = Math.max(shape.hops, chainDepth(node));
  },
};

const WHY = "A test nobody can read at a glance is where the wrong branch hides.";

/** Every limit the shape exceeds, each with the data its message names. */
function exceededLimits(shape, { maxCalls, maxHops, maxOperators }) {
  const combines = shape.calls > 0 || shape.operators > 0;
  const exceeded = [];
  if (shape.calls > maxCalls) exceeded.push(["tooManyCalls", { calls: shape.calls, maxCalls }]);
  if (shape.operators > maxOperators) {
    exceeded.push(["tooManyOperators", { maxOperators, operators: shape.operators }]);
  }
  // A chain alone is never reported: naming `a.b.c.length > 0` only restates it.
  if (combines && shape.hops > maxHops)
    exceeded.push(["chainTooDeep", { hops: shape.hops, maxHops }]);
  if (shape.nestedTernary) exceeded.push(["ternaryInTest", {}]);

  return exceeded;
}

export const conditionShapeRule = defineRule({
  name: "condition-shape",
  kind: "problem",
  messages: {
    tooManyCalls: {
      what: "This test makes {{calls}} calls; `maxCalls` is {{maxCalls}}.",
      why: WHY,
      fix:
        "Read each call into a named `const` above the test, or return, `continue` or `break` as" +
        " soon as the first one fails so each remaining test makes one call. For a `switch`, read" +
        " the value once above it and switch on that read.",
    },
    tooManyOperators: {
      what: "This test joins {{operators}} logical operators; `maxOperators` is {{maxOperators}}.",
      why: WHY,
      fix:
        "Split it into guard clauses — return, `continue` or `break` as soon as one part fails —" +
        " or name the combined condition in a `const` that says what the branch means.",
    },
    chainTooDeep: {
      what: "This test reads a chain {{hops}} properties deep and also calls or combines; `maxHops` is {{maxHops}}.",
      why: WHY,
      fix:
        "Read the chain into a named `const` above the test; a chain alone, however deep, is fine" +
        " once it stops combining with anything else.",
    },
    ternaryInTest: {
      what: "This test has a ternary inside it.",
      why: WHY,
      fix: "Move the ternary out of the test: decide it in the branch it belongs to, not inside this condition. Read the `testing` skill.",
    },
  },
  options: {
    maxCalls: { type: "integer", minimum: 0, default: 1 },
    maxHops: { type: "integer", minimum: 0, default: 2 },
    maxOperators: { type: "integer", minimum: 0, default: 2 },
  },
  create(context, _file, limits) {
    // Conditions whose test the traversal is still inside, in source order. Every measured
    // node lands in each of them, which is what walking a test's subtree did.
    const open = [];
    const found = [];

    const measure = (node) => {
      for (let index = open.length - 1; index >= 0; index -= 1) {
        const { shape, test } = open[index];
        if (test.end <= node.start) open.splice(index, 1);
        else if (test.start <= node.start) MEASURED_TYPES[node.type](shape, node);
      }
    };
    const begin = (testOf) => (node) => {
      const test = testOf(node);
      if (!test) return;
      const shape = { calls: 0, hops: 0, nestedTernary: false, operators: 0 };
      const entry = { shape, test };
      open.push(entry);
      found.push(entry);
    };
    const testOf = (node) => node.test;

    return {
      CallExpression: measure,
      ConditionalExpression(node) {
        measure(node);
        begin(testOf)(node);
      },
      DoWhileStatement: begin(testOf),
      ForStatement: begin(testOf),
      IfStatement: begin(testOf),
      LogicalExpression: measure,
      MemberExpression: measure,
      SwitchStatement: begin((node) => node.discriminant),
      WhileStatement: begin(testOf),
      "Program:exit"() {
        for (const { shape, test } of found) {
          for (const [messageId, data] of exceededLimits(shape, limits)) {
            context.report({ node: test, messageId, data });
          }
        }
      },
    };
  },
});
