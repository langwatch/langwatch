import { defineRule } from "../define-rule.mjs";

// `for (;;)` and `while (true)` hide the exit in the body. A wait carries its
// deadline in the header, a retry a named budget; draining a stream until
// `done` is the idiom and is left alone.

function isStrictServerSource(file) {
  return file.role === "process" && Boolean(file.strictSource);
}

function isLiteralTrue(node) {
  return node?.type === "Literal" && node.value === true;
}

const STREAM_STEP = /^(?:read|next)$/;

function isAwaitedStreamStep(init) {
  if (init?.type !== "AwaitExpression" || init.argument.type !== "CallExpression") return false;
  const { callee } = init.argument;

  return (
    callee.type === "MemberExpression" && !callee.computed && STREAM_STEP.test(callee.property.name)
  );
}

/** The test that means "the stream ended": `done`, a renamed `done`, or `result.done`. */
function doneTestOf(declarator) {
  const { id } = declarator;
  if (id.type === "Identifier")
    return (test) =>
      test.type === "MemberExpression" &&
      test.object.type === "Identifier" &&
      test.object.name === id.name &&
      test.property.name === "done";
  const done =
    id.type === "ObjectPattern"
      ? id.properties.find((property) => property.key?.name === "done")
      : undefined;
  if (done?.value.type !== "Identifier") return undefined;

  return (test) => test.type === "Identifier" && test.name === done.value.name;
}

function isExit(statement) {
  const only = statement.type === "BlockStatement" ? statement.body[0] : statement;

  return only?.type === "BreakStatement" || only?.type === "ReturnStatement";
}

/** `const { done, value } = await reader.read(); if (done) break;`: the stream is the bound. */
function drainsAStream(loop) {
  if (loop.body.type !== "BlockStatement") return false;
  const doneTests = loop.body.body
    .filter((statement) => statement.type === "VariableDeclaration")
    .flatMap((statement) => statement.declarations)
    .filter((declarator) => isAwaitedStreamStep(declarator.init))
    .map(doneTestOf)
    .filter(Boolean);

  return loop.body.body.some(
    (statement) =>
      statement.type === "IfStatement" &&
      isExit(statement.consequent) &&
      doneTests.some((isDone) => isDone(statement.test)),
  );
}

export const unboundedLoopRule = defineRule({
  name: "unbounded-loop",
  kind: "problem",
  applies: (file) => file.isProduction && isStrictServerSource(file),
  messages: {
    unboundedLoop: {
      what: "This `{{form}}` loop states no exit condition in its header.",
      why: "When the exit lives in the body the reader has to find every return, break and throw to know when the loop ends.",
      fix: "State whichever bound this loop already tracks directly in its header — a deadline (`while (now() < deadline)`) or an attempt counter (`for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++)`) — or, if it tracks no such bound yet, move it into a function whose signature takes one as a parameter.",
    },
  },
  create(context) {
    return {
      ForStatement(node) {
        if (node.test || drainsAStream(node)) return;

        context.report({ node, messageId: "unboundedLoop", data: { form: "for (;;)" } });
      },
      WhileStatement(node) {
        if (!isLiteralTrue(node.test) || drainsAStream(node)) return;

        context.report({ node, messageId: "unboundedLoop", data: { form: "while (true)" } });
      },
      DoWhileStatement(node) {
        if (!isLiteralTrue(node.test) || drainsAStream(node)) return;

        context.report({ node, messageId: "unboundedLoop", data: { form: "do … while (true)" } });
      },
    };
  },
});
