import { defineRule } from "../define-rule.mjs";

const CONTROL_FLOW_STATEMENTS = new Set([
  "IfStatement",
  "ForStatement",
  "ForInStatement",
  "ForOfStatement",
  "WhileStatement",
  "DoWhileStatement",
  "TryStatement",
  "SwitchStatement",
]);

function hasBlankLine(source, previous, next) {
  return /\r?\n[ \t]*\r?\n/.test(source.slice(previous.range[1], next.range[0]));
}

export const logicalStatementSpacingRule = defineRule({
  name: "logical-statement-spacing",
  kind: "layout",
  fixable: "whitespace",
  messages: {
    statementSpacing: {
      what: "Separate control-flow statements and non-sole return/throw statements with one blank line.",
      fix: "Add a blank line.",
    },
  },
  create(context) {
    const source = context.sourceCode.text;
    const newline = source.includes("\r\n") ? "\r\n" : "\n";
    return {
      BlockStatement(node) {
        const statements = node.body;
        for (let index = 1; index < statements.length; index += 1) {
          const previous = statements[index - 1];
          const current = statements[index];
          const afterControlFlow = CONTROL_FLOW_STATEMENTS.has(previous.type);
          const beforeNonSoleExit =
            (current.type === "ReturnStatement" || current.type === "ThrowStatement") &&
            statements.length > 1;
          if (
            (!afterControlFlow && !beforeNonSoleExit) ||
            hasBlankLine(source, previous, current)
          ) {
            continue;
          }
          context.report({
            node: current,
            messageId: "statementSpacing",
            fix(fixer) {
              const between = source.slice(previous.range[1], current.range[0]);
              const lineBreaks = between.match(/\r?\n/g)?.length ?? 0;
              const firstLine = between.split(/\r?\n/, 1)[0] ?? "";
              const trailingComment = firstLine.match(
                /^[ \t]+(?:\/\/[^\r\n]*|\/\*[^]*?\*\/)[ \t]*$/,
              );
              const text = lineBreaks === 0 ? `${newline}${newline}` : newline;
              if (trailingComment) {
                const start = previous.range[1];
                const end = start + trailingComment[0].length;
                return fixer.insertTextAfterRange([start, end], text);
              }
              return fixer.insertTextAfterRange(previous.range, text);
            },
          });
        }
      },
    };
  },
});
