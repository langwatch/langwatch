import { walk } from "../ast.mjs";
import { isBaselined } from "../baseline.mjs";
import { defineRule } from "../define-rule.mjs";

// A condition is readable at a glance or it is named. The shape checks are
// the four ways a test stops being glanceable: a deep property chain, more
// than one call, a stack of logical operators, or a ternary inside the test.

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
      what: "This condition takes {{hops}} property hops, {{calls}} calls and {{operators}} logical operators to read.",
      why: "A test nobody can read at a glance is where the wrong branch hides.",
      fix: "Name it: assign it to a const and test the name.",
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
      if (isBaselined({ cwd: context.cwd, file: file.workspacePath, rule: "condition-shape" })) {
        return;
      }

      const shape = conditionShape(test);
      const unreadable =
        shape.hops > maxHops ||
        shape.calls > maxCalls ||
        shape.operators > maxOperators ||
        shape.nestedTernary;
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
