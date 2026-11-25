import { defineRule } from "../define-rule.mjs";

// `x as unknown as T` is a type hole: in production fix the type or parse at
// the seam; in a test build a typed stub. A lone `as any` is left to
// `typescript/no-explicit-any`, and `x as const as T` only widens a literal.
// A test may mark a cast that feeds the code under test a wrong-typed input on
// purpose; the marker, not the test's name, is honoured (Alex, 2026-09-27).

const GOVERNED = /^(?:enterprise\/modules|modules|apps|packages)\//;

function isGovernedSource(file) {
  return GOVERNED.test(file.workspacePath);
}

/** Production casts audited one by one: file, target, and why only the compiler can't see it. */
const AUDITED_BOUNDARIES = [
  // A loop-built record claimed against a variable-length tuple merge (Alex, 2026-09-28).
  { file: "packages/api/src/trpc/compose.ts", target: "TrpcRouterDeclaration<" },
];

function isAuditedBoundary(file, source, node) {
  const annotation = node.typeAnnotation;
  const target = annotation ? source.slice(annotation.start, annotation.end) : "";

  return AUDITED_BOUNDARIES.some(
    (boundary) => boundary.file === file.workspacePath && target.startsWith(boundary.target),
  );
}

const WHITESPACE = /\s+/g;
const LINE_COMMENT = /^\s*\/\//;
const WRONG_TYPED_INPUT_MARKER = /^\s*\/\/\s*wrong-typed input:\s*\S/;
const STATEMENT_CONTAINERS = new Set(["Program", "BlockStatement", "StaticBlock", "SwitchCase"]);

/** The statement a node sits in, as its own line of code reads it. */
function statementOf(node) {
  let current = node;
  while (current.parent && !STATEMENT_CONTAINERS.has(current.parent.type)) current = current.parent;

  return current;
}

/** Whether the `//` block directly above this cast's statement marks it a wrong-typed input. */
function isMarkedWrongTypedInput(source, node) {
  const lines = source.slice(0, statementOf(node).start).split("\n");
  lines.pop();
  for (let index = lines.length - 1; index >= 0 && LINE_COMMENT.test(lines[index]); index -= 1) {
    if (WRONG_TYPED_INPUT_MARKER.test(lines[index])) return true;
  }

  return false;
}
const NAME_BUDGET = 40;

/** The type as the reader sees it written, so the message quotes the source. */
function typeTextOf(source, annotation) {
  if (!annotation) return "a type";
  const text = source.slice(annotation.start, annotation.end).replace(WHITESPACE, " ").trim();
  if (text.length === 0) return "a type";

  return text.length > NAME_BUDGET ? `${text.slice(0, NAME_BUDGET)}…` : text;
}

/** `as const`: freezing a literal checks nothing away, so a cast over it is a single cast. */
function isConstAssertion(node) {
  const annotation = node.typeAnnotation;

  return annotation?.type === "TSTypeReference" && annotation.typeName?.name === "const";
}

export const standInCastRule = defineRule({
  name: "stand-in-cast",
  kind: "problem",
  applies: isGovernedSource,
  messages: {
    doubleCast: {
      what: "`as {{through}} as {{target}}` casts through {{through}} to reach {{target}}.",
      fix: "If this value crossed a trust boundary (network, database row, user input), parse it with the contract's Zod schema (`Schema.parse(value)`) instead of casting; otherwise fix the type of whatever produced it so the cast is unnecessary. Read the `contract` skill.",
      why: "A cast through `unknown` or `any` removes the only check that stood between the two types.",
    },
    doubleCastInTest: {
      what: "`as {{through}} as {{target}}` forces this test value to {{target}} without checking it.",
      fix: "Build the stub to {{target}}'s real shape instead of casting: give each mocked member its real signature so the object type-checks without the cast. Only when the test proves how the code handles a wrong-typed input, write `// wrong-typed input: <why>` on the line above the cast.",
      why: "A test value never crossed a trust boundary; the marker excuses one reviewed cast, not every cast in the test.",
    },
  },
  create(context, file) {
    const doubleCastId = file.isTest ? "doubleCastInTest" : "doubleCast";

    // The inner half of a double cast is reported once, as the outer one.
    const covered = new WeakSet();
    const source = context.sourceCode.text;

    return {
      TSAsExpression(node) {
        const inner = node.expression;
        if (covered.has(node) || inner?.type !== "TSAsExpression" || isConstAssertion(inner))
          return;

        covered.add(inner);
        if (file.isTest && isMarkedWrongTypedInput(source, node)) return;
        if (!file.isTest && isAuditedBoundary(file, source, node)) return;
        context.report({
          node,
          messageId: doubleCastId,
          data: {
            through: typeTextOf(source, inner.typeAnnotation),
            target: typeTextOf(source, node.typeAnnotation),
          },
        });
      },
    };
  },
});
