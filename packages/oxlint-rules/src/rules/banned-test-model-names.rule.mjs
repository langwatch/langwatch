import { isBaselined } from "../baseline.mjs";
import { defineRule } from "../define-rule.mjs";

// A test, fixture, scenario or seed that names a specific OpenAI model picks
// one that is cheap and capable so the suite stays affordable to run; the
// models below are either retired or cost more than the one everybody should
// default to. Production source is ungoverned on purpose — a gateway's own
// provider catalogue legitimately lists every model a provider ships,
// deprecated ones included.
//
// Autofix: the matched banned-model substring is replaced with `gpt-5-mini`
// in place, leaving the rest of the literal untouched. This is safe because
// the rule's governed set is test-shaped files only — the one behaviour
// change this can cause is a mocked or live-call test now naming
// `gpt-5-mini`, which CI validates the same way it validates any other test
// change. One exception: a `regex: "..."` property value is a matching
// pattern, not prose — the banned name inside it anchors a specific
// catalog/price-table row (`^(openai\/)?gpt-4o$`-shaped fixtures recur across
// the model-provider and trace cost-matching suites), and replacing part of
// an anchored pattern string silently changes what it matches rather than
// failing loudly. That one shape is reported without a fix; the exact
// occurrences it makes unsafe to sweep are file-level judgement calls a fixer
// cannot make from the AST alone (a real catalog/pricing/reasoning-config
// lookup keyed by the literal model id, or an alias table deliberately
// mapping the banned name onto a different, modern one) — left as findings
// for a human, not lint debt this rule pretends to close.

const TEST_DIRECTORY = /(?:^|\/)__tests__\//;
const TEST_FILE = /\.test\.tsx?$/;
const FIXTURE_FILE = /\.fixture\.tsx?$/;
const SPECS_DIRECTORY = /^specs\//;
const SCENARIO_FILE = /\.scenario\.[cm]?[jt]sx?$/;

const REPLACEMENT = "gpt-5-mini";

// Longer, more specific names first so an overlapping literal (`gpt-4o-mini`
// also contains `gpt-4o`) is claimed by the name that actually names it, and
// never double-reported under both. Each pattern carries its own `g` flag so
// every non-overlapping occurrence in a literal is found, not just the first.
const BANNED_MODELS = [
  { name: "gpt-4o-mini", pattern: /\bgpt-4o-mini\b/gi },
  { name: "gpt-4.1-mini", pattern: /\bgpt-4\.1-mini\b/gi },
  { name: "gpt-4-turbo", pattern: /\bgpt-4-turbo\b/gi },
  { name: "gpt-3.5-turbo", pattern: /\bgpt-3\.5-turbo\b/gi },
  { name: "gpt-4o", pattern: /\bgpt-4o\b/gi },
  { name: "gpt-4.1", pattern: /\bgpt-4\.1\b/gi },
];

function isGoverned(file) {
  const path = file.workspacePath;
  return (
    TEST_DIRECTORY.test(path) ||
    TEST_FILE.test(path) ||
    FIXTURE_FILE.test(path) ||
    SPECS_DIRECTORY.test(path) ||
    SCENARIO_FILE.test(path)
  );
}

/**
 * Every non-overlapping banned-model match in `text`, in source order.
 * @param {string} text
 * @returns {{ name: string, start: number, end: number }[]}
 */
function findBannedModels(text) {
  const claimed = [];
  const matches = [];
  for (const { name, pattern } of BANNED_MODELS) {
    pattern.lastIndex = 0;
    let match = pattern.exec(text);
    while (match) {
      const start = match.index;
      const end = start + match[0].length;
      if (!claimed.some(([claimedStart, claimedEnd]) => start < claimedEnd && end > claimedStart)) {
        claimed.push([start, end]);
        matches.push({ end, name, start });
      }
      match = pattern.exec(text);
    }
  }
  return matches.sort((a, b) => a.start - b.start);
}

/** Whether `node` is the value of an object property literally named `regex`. */
function isRegexPatternValue(node) {
  const { parent } = node;
  if (!parent || parent.type !== "Property" || parent.computed || parent.value !== node) {
    return false;
  }
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
    if (
      isBaselined({ cwd: context.cwd, file: file.workspacePath, rule: "banned-test-model-names" })
    ) {
      return {};
    }

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
