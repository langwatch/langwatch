import { isBaselined } from "../baseline.mjs";
import { defineRule } from "../define-rule.mjs";

// `x as unknown as T` and `x as any` are a type hole with a comment attached.
// In production, fix the type or parse at the seam it arrives. In a test,
// there is no trust boundary to parse at - build a typed stub instead
// (a factory/builder, or `satisfies`). `as const` and a narrowing `as T` on
// a literal are untouched in both.

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

function isAnyAnnotation(annotation) {
  return annotation?.type === "TSAnyKeyword";
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
    anyCast: {
      what: "`as any` drops the type of this expression.",
      fix: "If this value crossed a trust boundary (network, database row, user input), parse it with the contract's Zod schema (`Schema.parse(value)`) instead of casting; otherwise name its real type in place of `any`.",
    },
    doubleCastInTest: {
      what: "`as {{through}} as {{target}}` forces this test value to {{target}} without checking it.",
      fix: "Build the stub to {{target}}'s real shape instead of casting: give each mocked member its real signature so the object type-checks without the cast.",
      why: "A test value never crossed a trust boundary, so there is nothing to parse — the fix is a typed stub, not a schema.",
    },
    anyCastInTest: {
      what: "`as any` drops the type of this test stub.",
      fix: "Build the stub to the real type instead of casting: give each mocked member its real signature so the object type-checks without the cast.",
    },
  },
  create(context, file) {
    if (isBaselined({ cwd: context.cwd, file: file.workspacePath, rule: "stand-in-cast" })) {
      return {};
    }

    const doubleCastId = file.isTest ? "doubleCastInTest" : "doubleCast";
    const anyCastId = file.isTest ? "anyCastInTest" : "anyCast";

    // The inner half of a double cast is reported once, as the outer one.
    const covered = new WeakSet();
    const source = context.sourceCode.text;

    return {
      TSAsExpression(node) {
        if (covered.has(node)) return;

        const inner = node.expression;
        if (inner?.type === "TSAsExpression") {
          covered.add(inner);
          context.report({
            node,
            messageId: doubleCastId,
            data: {
              through: typeTextOf(source, inner.typeAnnotation),
              target: typeTextOf(source, node.typeAnnotation),
            },
          });

          return;
        }

        if (isAnyAnnotation(node.typeAnnotation)) {
          context.report({ node, messageId: anyCastId });
        }
      },
      TSTypeAssertion(node) {
        if (isAnyAnnotation(node.typeAnnotation)) {
          context.report({ node, messageId: anyCastId });
        }
      },
    };
  },
});
