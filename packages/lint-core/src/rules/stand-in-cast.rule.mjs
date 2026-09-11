import { isBaselined } from "../baseline.mjs";
import { defineRule } from "../define-rule.mjs";

// `x as unknown as T` and `x as any` are the two ways to tell the compiler to
// stop asking. Both are a type hole with a comment attached: the value is
// whatever it was at runtime and the reader is told otherwise. Fix the type,
// or parse the value at the seam where it arrives. `as const`, a widening
// `as T` on a literal, and `satisfies` all keep the check and are untouched.

const GOVERNED = /^(?:enterprise\/modules|modules|apps|packages)\//;

function isGovernedSource(file) {
  return file.isProduction && GOVERNED.test(file.workspacePath);
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
      fix: "Give the value the type it really has, or parse it at the seam with the contract's schema.",
      why: "A cast through `unknown` or `any` removes the only check that stood between the two types.",
    },
    anyCast: {
      what: "`as any` drops the type of this expression.",
      fix: "Name the real type, or parse the value at the seam with the contract's schema.",
    },
  },
  create(context, file) {
    if (isBaselined({ cwd: context.cwd, file: file.workspacePath, rule: "stand-in-cast" })) {
      return {};
    }

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
            messageId: "doubleCast",
            data: {
              through: typeTextOf(source, inner.typeAnnotation),
              target: typeTextOf(source, node.typeAnnotation),
            },
          });

          return;
        }

        if (isAnyAnnotation(node.typeAnnotation)) {
          context.report({ node, messageId: "anyCast" });
        }
      },
      TSTypeAssertion(node) {
        if (isAnyAnnotation(node.typeAnnotation)) {
          context.report({ node, messageId: "anyCast" });
        }
      },
    };
  },
});
