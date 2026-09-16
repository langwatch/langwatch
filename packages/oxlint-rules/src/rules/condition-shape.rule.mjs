import { walk } from "../ast.mjs";
import { defineRule } from "../define-rule.mjs";

// A condition is readable at a glance or it is named. What costs a reader is
// a test that calls or combines: more than one call, a stack of logical
// operators, or a ternary inside the test. A property chain is a path to a
// value rather than complexity of its own, so depth is only counted once the
// test already does one of those.

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

export const conditionShapeRule = defineRule({
  name: "condition-shape",
  kind: "problem",
  messages: {
    nameCondition: {
      what: "This test combines {{calls}} calls and {{operators}} logical operators across a chain {{hops}} properties deep.",
      why: "A test nobody can read at a glance is where the wrong branch hides.",
      fix:
        "Split it into guard clauses: return, `continue`, or `break` as soon as one part fails, so"
        + " each remaining test keeps at most one call and no combined operator — a chain alone,"
        + " however deep, is fine once it stops combining with anything else. For a `switch`, read"
        + " the value once above it and switch on that read. Move a ternary out of the test"
        + " entirely: decide it in the branch it already belongs to, not nested inside this one.",
    },
  },
  options: {
    maxCalls: { type: "integer", minimum: 0, default: 1 },
    maxHops: { type: "integer", minimum: 0, default: 2 },
    maxOperators: { type: "integer", minimum: 0, default: 2 },
  },
  create(context, file, { maxCalls, maxHops, maxOperators }) {
    const check = (test) => {
      if (!test) return;

      const shape = conditionShape(test);
      // Naming `a.b.c.length > 0` restates it and tells the reader nothing, so
      // a chain on its own is never reported however deep it runs.
      const combines = shape.calls > 0 || shape.operators > 0;
      const unreadable =
        shape.calls > maxCalls ||
        shape.operators > maxOperators ||
        shape.nestedTernary ||
        (combines && shape.hops > maxHops);
      if (!unreadable) return;

      context.report({
        node: test,
        messageId: "nameCondition",
        data: { calls: shape.calls, hops: shape.hops, operators: shape.operators },
      });
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
