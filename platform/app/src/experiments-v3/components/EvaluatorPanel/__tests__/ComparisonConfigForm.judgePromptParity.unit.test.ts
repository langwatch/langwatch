/**
 * The four default Comparison judge prompts are written down twice: in the
 * langevals evaluator, which is the source of truth and the thing that
 * actually calls the model, and again in this config form. Both files say
 * they are kept byte-identical. Until this test, nothing checked.
 *
 * They have to match because both sides ask the same question by string
 * equality: "is this prompt still one of the shipped defaults?". The judge
 * asks it to decide whether it may swap in the template that matches what the
 * row really carries (select_best_compare.py), and the form asks it to decide
 * whether it may re-default the prompt when the golden toggle changes
 * (ComparisonConfigForm.tsx). One character of drift and an untouched prompt
 * stops being recognized on one side: the per-row adaptation quietly stops
 * applying, and a comparison with no reference answer goes out framed around
 * a reference it does not have, with an empty "Reference:" line. Nothing
 * throws and nothing logs, the judging just gets worse.
 *
 * So the Python file is read and parsed here at test time. Pasting the
 * prompts into the test would only add a third copy to drift.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  ALL_DEFAULT_JUDGE_PROMPTS,
  JUDGE_PROMPT_GOLDEN_INPUT,
  JUDGE_PROMPT_GOLDEN_NO_INPUT,
  JUDGE_PROMPT_NO_GOLDEN_INPUT,
  JUDGE_PROMPT_NO_GOLDEN_NO_INPUT,
} from "../ComparisonConfigForm";

// `process.cwd()` is the platform/app/ package dir when vitest runs, so two
// levels up lands on the repo root reliably across worktrees and CI. Same
// resolution as server/evaluations/__tests__/helm-langevals-memory.
const REPO_ROOT = path.resolve(process.cwd(), "..", "..");

const EVALUATOR_SOURCE =
  "services/langevals/evaluators/langevals/langevals_langevals/select_best_compare.py";
const CONFIG_FORM_SOURCE =
  "platform/app/src/experiments-v3/components/EvaluatorPanel/ComparisonConfigForm.tsx";

/** `DEFAULT_SELECT_BEST_PROMPT... = """..."""`, at the start of a line so a
 * docstring or a mention in prose can never be mistaken for a declaration. */
const PYTHON_PROMPT_DECLARATION =
  /^(DEFAULT_SELECT_BEST_PROMPT[A-Z_]*)\s*=\s*"""([\s\S]*?)"""/gm;

/**
 * The escapes a plain (non-raw) Python string literal can carry. The
 * backslash-newline is the line continuation in `"""\` that keeps the prompt
 * from starting with a blank line, and is the only one the file uses today.
 * Anything outside this table is rejected rather than guessed at: a parser
 * that quietly mis-decodes would compare a value the judge never sends, and
 * pass while the real prompts drift.
 */
const PYTHON_ESCAPES: Record<string, string> = {
  "\n": "",
  "\\": "\\",
  n: "\n",
  r: "\r",
  t: "\t",
  '"': '"',
  "'": "'",
};

function decodePythonStringBody(body: string, constant: string): string {
  return body.replace(/\\([\s\S])/g, (_match, escaped: string) => {
    const decoded = PYTHON_ESCAPES[escaped];
    if (decoded === undefined) {
      throw new Error(
        `Unsupported Python escape \\${escaped} in ${constant} (${EVALUATOR_SOURCE}). ` +
          `Teach PYTHON_ESCAPES about it, decoding it wrong would compare a ` +
          `prompt the judge never sends.`,
      );
    }
    return decoded;
  });
}

/** Every default judge prompt the evaluator ships, keyed by constant name. */
function parseShippedJudgePrompts(
  pythonSource: string,
): Record<string, string> {
  const prompts: Record<string, string> = {};

  PYTHON_PROMPT_DECLARATION.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PYTHON_PROMPT_DECLARATION.exec(pythonSource)) !== null) {
    const [, name, body] = match;
    if (name === undefined || body === undefined) continue;
    prompts[name] = decodePythonStringBody(body, name);
  }

  return prompts;
}

/** Which config-form constant mirrors which of the judge's own defaults. */
const PROMPT_PAIRS = [
  {
    judge: "DEFAULT_SELECT_BEST_PROMPT",
    form: "JUDGE_PROMPT_GOLDEN_INPUT",
    value: JUDGE_PROMPT_GOLDEN_INPUT,
  },
  {
    judge: "DEFAULT_SELECT_BEST_PROMPT_GOLDEN_NO_INPUT",
    form: "JUDGE_PROMPT_GOLDEN_NO_INPUT",
    value: JUDGE_PROMPT_GOLDEN_NO_INPUT,
  },
  {
    judge: "DEFAULT_SELECT_BEST_PROMPT_NO_GOLDEN",
    form: "JUDGE_PROMPT_NO_GOLDEN_INPUT",
    value: JUDGE_PROMPT_NO_GOLDEN_INPUT,
  },
  {
    judge: "DEFAULT_SELECT_BEST_PROMPT_NO_GOLDEN_NO_INPUT",
    form: "JUDGE_PROMPT_NO_GOLDEN_NO_INPUT",
    value: JUDGE_PROMPT_NO_GOLDEN_NO_INPUT,
  },
] as const;

/** Whitespace is exactly what drifts and exactly what a plain diff hides, so
 * both sides are quoted with their escapes visible. */
function driftReport({
  judge,
  form,
  fromJudge,
  fromForm,
}: {
  judge: string;
  form: string;
  fromJudge: string | undefined;
  fromForm: string;
}): string {
  return [
    `Default judge prompt drifted: ${judge} no longer matches ${form}.`,
    `  ${EVALUATOR_SOURCE}`,
    `    ${judge} = ${JSON.stringify(fromJudge ?? null)}`,
    `  ${CONFIG_FORM_SOURCE}`,
    `    ${form} = ${JSON.stringify(fromForm)}`,
    `The evaluator is the source of truth: copy its value into ${form}.`,
  ].join("\n");
}

describe("given the default judge prompts are written down in both the evaluator and the config form", () => {
  const shippedByJudge = parseShippedJudgePrompts(
    readFileSync(path.join(REPO_ROOT, EVALUATOR_SOURCE), "utf8"),
  );

  describe("when the two copies are compared", () => {
    /** @scenario "The shipped judge prompts are identical wherever they are written down" */
    it("finds every default byte-identical to the judge's own", () => {
      // Counts first. A fifth default added to one side alone is drift too,
      // and every pair below would still read as matching.
      expect(
        Object.keys(shippedByJudge).sort(),
        `${EVALUATOR_SOURCE} ships a different set of defaults than ${CONFIG_FORM_SOURCE} mirrors. ` +
          `Add or drop the matching JUDGE_PROMPT_* constant and its entry in PROMPT_PAIRS here.`,
      ).toEqual(PROMPT_PAIRS.map(({ judge }) => judge).sort());

      expect(
        [...ALL_DEFAULT_JUDGE_PROMPTS].sort(),
        `ALL_DEFAULT_JUDGE_PROMPTS in ${CONFIG_FORM_SOURCE} does not hold exactly the ` +
          `${PROMPT_PAIRS.length} mirrored defaults. A default missing from it is never ` +
          `recognized as untouched; an extra one has no counterpart in ${EVALUATOR_SOURCE}.`,
      ).toEqual(PROMPT_PAIRS.map(({ value }) => value).sort());

      for (const { judge, form, value } of PROMPT_PAIRS) {
        const fromJudge = shippedByJudge[judge];
        expect(
          value,
          driftReport({ judge, form, fromJudge, fromForm: value }),
        ).toBe(fromJudge);
      }
    });
  });

  describe("when the parser itself is checked", () => {
    // A parser that silently reads nothing, or reads the Python literal's
    // punctuation along with the text, would pass the comparison above
    // forever while the prompts drifted underneath it.
    it("reads the prompt text rather than the literal wrapped around it", () => {
      const goldenAndInput = shippedByJudge.DEFAULT_SELECT_BEST_PROMPT;

      expect(goldenAndInput).toBeDefined();
      expect(goldenAndInput).toMatch(/^Pick the best of N candidate replies/);
      expect(goldenAndInput).toContain("{candidates}");
      expect(goldenAndInput).not.toContain('"""');
      expect(goldenAndInput).not.toContain("\\");
    });

    it("rejects an escape it does not understand instead of guessing", () => {
      expect(() =>
        parseShippedJudgePrompts(
          'DEFAULT_SELECT_BEST_PROMPT_X = """a\\u0041b"""',
        ),
      ).toThrow(/Unsupported Python escape/);
    });
  });
});
