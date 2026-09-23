import { defineRule } from "../define-rule.mjs";

// Tests name a cheap model; production and the model catalogue are ungoverned.
// Why each exemption holds: specs/tooling/lint-banned-test-model-names.feature.

const TEST_DIRECTORY = /(?:^|\/)__tests__\//;
const TEST_FILE = /\.test\.tsx?$/;
const FIXTURE_FILE = /\.fixture\.tsx?$/;
const SPECS_DIRECTORY = /^specs\//;
const SCENARIO_FILE = /\.scenario\.[cm]?[jt]sx?$/;

// The module whose subject is the model catalogue itself.
const MODEL_CATALOGUE_MODULE = /^modules\/model-provider\//;

const REPLACEMENT = "gpt-5-mini";

// A match is the whole id: `gpt-4o-2024-08-06` is another model, and rewriting
// its prefix would invent `gpt-5-mini-2024-08-06`. A closing period still ends one.
const BEFORE = String.raw`(?<![-\w.])`;
const AFTER = String.raw`(?![-\w]|\.\w)`;

function bannedPattern(id) {
  return new RegExp(`${BEFORE}${id.replaceAll(".", String.raw`\.`)}${AFTER}`, "gi");
}

const BANNED_MODELS = [
  "gpt-4o-mini",
  "gpt-4.1-mini",
  "gpt-4-turbo",
  "gpt-3.5-turbo",
  "gpt-4o",
  "gpt-4.1",
].map((name) => ({ name, pattern: bannedPattern(name) }));

function isGoverned(file) {
  const path = file.workspacePath;
  if (MODEL_CATALOGUE_MODULE.test(path)) return false;

  return (
    TEST_DIRECTORY.test(path) ||
    TEST_FILE.test(path) ||
    FIXTURE_FILE.test(path) ||
    SPECS_DIRECTORY.test(path) ||
    SCENARIO_FILE.test(path)
  );
}

/**
 * Every banned-model id in `text`, in source order; the anchors keep them disjoint.
 * @param {string} text
 * @returns {{ name: string, start: number, end: number }[]}
 */
function findBannedModels(text) {
  const matches = [];
  for (const { name, pattern } of BANNED_MODELS) {
    for (const match of text.matchAll(pattern)) {
      matches.push({ end: match.index + match[0].length, name, start: match.index });
    }
  }
  return matches.toSorted((a, b) => a.start - b.start);
}

/** Whether `node` is the value of an object property literally named `regex`. */
function isRegexPatternValue(node) {
  const { parent } = node;
  if (!parent) return false;
  if (parent.type !== "Property") return false;
  if (parent.computed) return false;
  if (parent.value !== node) return false;
  const { key } = parent;
  if (key.type === "Identifier") return key.name === "regex";
  if (key.type === "Literal") return key.value === "regex";
  return false;
}

export const bannedTestModelNamesRule = defineRule({
  name: "banned-test-model-names",
  kind: "problem",
  fixable: "code",
  messages: {
    bannedModelName: {
      what: "This literal names the retired or overpriced model `{{name}}`.",
      why: "gpt-5-mini is the cheapest and most capable model, and the whole suite should default to it.",
      fix: "Use `gpt-5-mini` instead.",
    },
  },
  create(context, file) {
    if (!isGoverned(file)) return {};

    const source = context.sourceCode.text;

    function reportEach(node, rangeStart, text) {
      const fixable = !isRegexPatternValue(node);
      for (const { end, name, start } of findBannedModels(text)) {
        context.report({
          node,
          messageId: "bannedModelName",
          data: { name },
          ...(fixable && {
            fix: (fixer) =>
              fixer.replaceTextRange([rangeStart + start, rangeStart + end], REPLACEMENT),
          }),
        });
      }
    }

    return {
      Literal(node) {
        if (typeof node.value !== "string") return;
        reportEach(node, node.range[0], source.slice(node.range[0], node.range[1]));
      },
      TemplateLiteral(node) {
        for (const quasi of node.quasis) {
          reportEach(quasi, quasi.range[0], source.slice(quasi.range[0], quasi.range[1]));
        }
      },
    };
  },
});
