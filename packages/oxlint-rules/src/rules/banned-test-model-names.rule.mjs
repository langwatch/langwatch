import { isBaselined } from "../baseline.mjs";
import { defineRule } from "../define-rule.mjs";

// A test, fixture, scenario or seed that names a specific OpenAI model picks
// one that is cheap and capable so the suite stays affordable to run; the
// models below are either retired or cost more than the one everybody should
// default to. Production source is ungoverned on purpose — a gateway's own
// provider catalogue legitimately lists every model a provider ships,
// deprecated ones included.

const TEST_DIRECTORY = /(?:^|\/)__tests__\//;
const TEST_FILE = /\.test\.tsx?$/;
const FIXTURE_FILE = /\.fixture\.tsx?$/;
const SPECS_DIRECTORY = /^specs\//;
const SCENARIO_FILE = /\.scenario\.[cm]?[jt]sx?$/;

// Longer, more specific names first so an overlapping literal (`gpt-4o-mini`
// also contains `gpt-4o`) is reported under the name that actually names it.
const BANNED_MODELS = [
  { name: "gpt-4o-mini", pattern: /\bgpt-4o-mini\b/i },
  { name: "gpt-4.1-mini", pattern: /\bgpt-4\.1-mini\b/i },
  { name: "gpt-4-turbo", pattern: /\bgpt-4-turbo\b/i },
  { name: "gpt-3.5-turbo", pattern: /\bgpt-3\.5-turbo\b/i },
  { name: "gpt-4o", pattern: /\bgpt-4o\b/i },
  { name: "gpt-4.1", pattern: /\bgpt-4\.1\b/i },
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

/** The literal string a node holds, from a plain string or a plain template literal. */
function textOf(node) {
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  if (node.type === "TemplateLiteral" && node.expressions.length === 0) {
    return node.quasis[0]?.value?.cooked ?? node.quasis[0]?.value?.raw;
  }
  return undefined;
}

function bannedModelIn(text) {
  for (const { name, pattern } of BANNED_MODELS) {
    if (pattern.test(text)) return name;
  }
  return undefined;
}

export const bannedTestModelNamesRule = defineRule({
  name: "banned-test-model-names",
  kind: "problem",
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

    function check(node) {
      const text = textOf(node);
      if (text === undefined) return;
      const name = bannedModelIn(text);
      if (name) context.report({ node, messageId: "bannedModelName", data: { name } });
    }

    return {
      Literal: check,
      TemplateLiteral: check,
    };
  },
});
