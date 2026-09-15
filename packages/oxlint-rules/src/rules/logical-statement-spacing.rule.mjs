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

/** Chain members that open a new group: one procedure, one route. */
const CHAIN_GROUP_OPENERS = new Set([
  "procedure",
  "query",
  "mutation",
  "subscription",
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "head",
  "options",
]);

const BLANK_LINE = /\r?\n[ \t]*\r?\n/;

function hasBlankLine(source, previous, next) {
  return BLANK_LINE.test(source.slice(previous.range[1], next.range[0]));
}

function spansLines(node) {
  return node.loc.start.line !== node.loc.end.line;
}

function isExit(node) {
  return node.type === "ReturnStatement" || node.type === "ThrowStatement";
}

/** The `.name(...)` segments of a call chain, outermost last. */
function chainSegments(call) {
  const segments = [];
  let node = call;
  while (node.type === "CallExpression" && node.callee.type === "MemberExpression") {
    const { callee } = node;
    if (!callee.computed && callee.property.type === "Identifier") {
      segments.unshift({ call: node, callee, name: callee.property.name });
    }
    node = callee.object;
  }
  return segments;
}

function isChainTop(node) {
  const { parent } = node;
  return !(parent?.type === "MemberExpression" && parent.object === node);
}

function insertBlankLine(fixer, source, newline, previousEnd, nextStart) {
  const between = source.slice(previousEnd, nextStart);
  const lineBreaks = between.match(/\r?\n/g)?.length ?? 0;
  const firstLine = between.split(/\r?\n/, 1)[0] ?? "";
  const trailingComment = firstLine.match(/^[ \t]+(?:\/\/[^\r\n]*|\/\*[^]*?\*\/)[ \t]*$/);
  const text = lineBreaks === 0 ? `${newline}${newline}` : newline;
  if (trailingComment) {
    return fixer.insertTextAfterRange([previousEnd, previousEnd + trailingComment[0].length], text);
  }
  return fixer.insertTextAfterRange([previousEnd, previousEnd], text);
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
    paragraphSpacing: {
      what: "A statement that spans several lines stands alone: one blank line before and after it.",
      fix: "Add a blank line.",
    },
    chainGroupSpacing: {
      what: "Each .{{opener}}(...) group in a chain starts after one blank line.",
      fix: "Add a blank line before the group.",
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
          if (hasBlankLine(source, previous, current)) continue;

          const afterControlFlow = CONTROL_FLOW_STATEMENTS.has(previous.type);
          const beforeNonSoleExit = isExit(current) && statements.length > 1;
          const aroundParagraph = spansLines(previous) || spansLines(current);
          const messageId = afterControlFlow || beforeNonSoleExit
            ? "statementSpacing"
            : aroundParagraph
              ? "paragraphSpacing"
              : undefined;
          if (!messageId) continue;

          context.report({
            node: current,
            messageId,
            fix: (fixer) =>
              insertBlankLine(fixer, source, newline, previous.range[1], current.range[0]),
          });
        }
      },
      CallExpression(node) {
        if (!isChainTop(node) || !spansLines(node)) return;

        const openers = chainSegments(node).filter((segment) =>
          CHAIN_GROUP_OPENERS.has(segment.name),
        );
        for (const segment of openers.slice(1)) {
          const objectEnd = segment.callee.object.range[1];
          const propertyStart = segment.callee.property.range[0];
          if (BLANK_LINE.test(source.slice(objectEnd, propertyStart))) continue;

          context.report({
            node: segment.callee.property,
            messageId: "chainGroupSpacing",
            data: { opener: segment.name },
            fix: (fixer) => insertBlankLine(fixer, source, newline, objectEnd, propertyStart),
          });
        }
      },
    };
  },
});
