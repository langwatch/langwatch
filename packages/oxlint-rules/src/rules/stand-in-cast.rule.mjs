import { defineRule } from "../define-rule.mjs";

// `x as unknown as T` is a type hole: in production fix the type or parse at
// the seam; in a test build a typed stub. A lone `as any` is left to
// `typescript/no-explicit-any`, and `x as const as T` only widens a literal.

const GOVERNED = /^(?:enterprise\/modules|modules|apps|packages)\//;

function isGovernedSource(file) {
  return GOVERNED.test(file.workspacePath);
}

const WHITESPACE = /\s+/g;
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
      fix: "If this value crossed a trust boundary (network, database row, user input), parse it with the contract's Zod schema (`Schema.parse(value)`) instead of casting; otherwise fix the type of whatever produced it so the cast is unnecessary.",
      why: "A cast through `unknown` or `any` removes the only check that stood between the two types.",
    },
    doubleCastInTest: {
      what: "`as {{through}} as {{target}}` forces this test value to {{target}} without checking it.",
      fix: "Build the stub to {{target}}'s real shape instead of casting: give each mocked member its real signature so the object type-checks without the cast.",
      why: "A test value never crossed a trust boundary, so there is nothing to parse — the fix is a typed stub, not a schema.",
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
