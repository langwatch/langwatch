import { defineRule } from "../define-rule.mjs";

function booleanLeafCount(node) {
  if (node.type !== "LogicalExpression" || (node.operator !== "&&" && node.operator !== "||")) {
    return 1;
  }
  return booleanLeafCount(node.left) + booleanLeafCount(node.right);
}

export const booleanWallRule = defineRule({
  name: "boolean-wall",
  kind: "problem",
  messages: {
    booleanWall: {
      what: "This condition has {{leaves}} leaf tests; the maximum is 3.",
      fix: "Assign a group of them to a named const and test the name.",
    },
  },
  create(context) {
    return {
      LogicalExpression(node) {
        if (
          node.parent?.type === "LogicalExpression" &&
          (node.parent.operator === "&&" || node.parent.operator === "||")
        ) {
          return;
        }
        const leaves = booleanLeafCount(node);
        if (leaves > 3) {
          context.report({ node, messageId: "booleanWall", data: { leaves } });
        }
      },
    };
  },
});
