import { walk } from "../ast.mjs";
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

/** The four measurements the rule reports, in one walk of the test expression. */
export function conditionShape(test) {
  const shape = { calls: 0, hops: 0, nestedTernary: false, operators: 0 };

  walk(test, (node) => {
    switch (node.type) {
      case "MemberExpression":
      case "OptionalMemberExpression":
        shape.hops = Math.max(shape.hops, chainDepth(node));
        break;
      case "CallExpression":
      case "OptionalCallExpression":
        shape.calls += 1;
        break;
      case "LogicalExpression":
        if (CONDITION_LOGICAL_OPERATORS.has(node.operator)) shape.operators += 1;
        break;
      case "ConditionalExpression":
        shape.nestedTernary = true;
        break;
      default:
        break;
    }
  });

  return shape;
}

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
      fix: "Move the ternary out of the test: decide it in the branch it belongs to, not inside this condition.",
    },
  },
  options: {
    maxCalls: { type: "integer", minimum: 0, default: 1 },
    maxHops: { type: "integer", minimum: 0, default: 2 },
    maxOperators: { type: "integer", minimum: 0, default: 2 },
  },
  create(context, _file, limits) {
    const check = (test) => {
      if (!test) return;

      for (const [messageId, data] of exceededLimits(conditionShape(test), limits)) {
        context.report({ node: test, messageId, data });
      }
    };

    return {
      ConditionalExpression: (node) => check(node.test),
      DoWhileStatement: (node) => check(node.test),
      ForStatement: (node) => check(node.test),
      IfStatement: (node) => check(node.test),
      SwitchStatement: (node) => check(node.discriminant),
      WhileStatement: (node) => check(node.test),
    };
  },
});
