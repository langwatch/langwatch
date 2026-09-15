import { defineRule } from "../define-rule.mjs";

export const maxStatementsPerLineRule = defineRule({
  name: "max-statements-per-line",
  kind: "problem",
  applies: (file) => file.isServiceModule,
  messages: {
    maxStatementsPerLine: {
      what: "Two statements share line {{line}}.",
      fix: "Put each on its own line.",
    },
  },
  create(context) {
    return {
      BlockStatement(node) {
        const statementByLine = new Map();
        for (const statement of node.body) {
          const line = statement.loc.start.line;
          const prior = statementByLine.get(line);
          if (prior) {
            context.report({
              node: statement,
              messageId: "maxStatementsPerLine",
              data: { line },
            });
          }
          statementByLine.set(line, statement);
        }
      },
    };
  },
});
