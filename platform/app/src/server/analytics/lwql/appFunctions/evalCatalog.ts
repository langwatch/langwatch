/**
 * The eval functions — the half of the catalog whose value is a judgement.
 *
 * Same machinery as the extraction functions in `./catalog.ts`: a projection
 * UDF in ClickHouse, projection-only, alias required, value computed after the
 * query. What differs is where the value comes from. An extraction function
 * reads a trace; an eval function asks the classifier a question about a text,
 * and that text is normally another app function — which is why an eval call is
 * the one place the validator allows nesting.
 *
 * ## Why there are two names for one boolean question
 *
 * `eval(text, instructions)` and `eval(text, instructions, criteria)` were
 * meant to be one name with two arities. ClickHouse will not have it: a SQL UDF
 * is a lambda with a fixed parameter list, and calling one with any other count
 * is `BAD_ARGUMENTS` (36) — "Lambda (a, b) -> a expect 2 arguments. Actual: 3",
 * measured on 25.8. One name is one arity, and there is no overloading.
 *
 * So the criteria form is its own function, `eval_criteria`, which is the same
 * shape the rest of this family already has: the name says what the extra
 * argument is (`eval_passed` takes a threshold, `eval_score` a range,
 * `eval_category` its options). A three-argument `eval` is refused by arity
 * with a message naming `eval_criteria`, so the spelling an agent reaches for
 * first still leads to the right one in a single round trip.
 *
 * @see ./catalog.ts — the shared declaration these join
 * @see ../../../app-layer/instant-evals/classifier/classifier.ts
 * @see ../../../../../specs/lwql/eval-functions.feature
 */

import type { InstantEvalQuestionKind } from "~/server/app-layer/instant-evals/classifier/classifier";
import type {
  LangWatchQLAppFunctionDefinition,
  LangWatchQLAppFunctionParameter,
} from "./catalog";

/** Which part of a verdict a judged column carries. */
export type LangWatchQLJudgementReading =
  | "probability"
  | "passed"
  | "score"
  | "label"
  | "probabilities";

/** How one eval function asks its question and reads its answer. */
export interface LangWatchQLJudgement {
  readonly kind: InstantEvalQuestionKind;
  readonly reads: LangWatchQLJudgementReading;
}

const TEXT_KEY: LangWatchQLAppFunctionParameter = {
  name: "text",
  role: "key",
  type: "string",
  description:
    "The text to judge. Usually an extraction function over the row, which is the one place a function may be nested; any other expression the query allows also works.",
};

const INSTRUCTIONS: LangWatchQLAppFunctionParameter = {
  name: "instructions",
  role: "option",
  type: "string",
  minLength: 1,
  description:
    "The question, in your own words, as you would write it for a human reader.",
};

const EXAMPLE_TEXT = "conversation_bounded(ConversationId, 8000, '')";

function evalExample({
  database,
  call,
  alias,
}: {
  database: string;
  call: string;
  alias: string;
}): string {
  return (
    `SELECT ConversationId, ${call} AS ${alias}\n` +
    `FROM ${database}.trace_metrics\n` +
    `WHERE OccurredAt >= subtractDays(now(), 7) AND ConversationId != ''\n` +
    `GROUP BY ConversationId\n` +
    `ORDER BY ConversationId\n` +
    `LIMIT 20`
  );
}

/**
 * Every eval function this API publishes.
 *
 * None of them declares a content gate of its own. The text they judge is an
 * expression the walk has already checked — a gated column is refused where it
 * is written, and a nested extraction function is refused by its own gates — so
 * a gate here would either duplicate that check or contradict it.
 */
export const LWQL_EVAL_FUNCTION_CATALOG: readonly LangWatchQLAppFunctionDefinition[] =
  [
    {
      name: "eval",
      kind: "eval",
      judgement: { kind: "boolean", reads: "probability" },
      description:
        "How likely the statement is true of the text, between 0 and 1. The judge is calibrated, so 0.9 means nine times in ten rather than a confident yes.",
      parameters: [TEXT_KEY, INSTRUCTIONS],
      keyKind: "text",
      returns: "Nullable(Float64)",
      encoding: "text",
      gates: [],
      example: (database) =>
        evalExample({
          database,
          call: `eval(${EXAMPLE_TEXT}, 'The customer sounds annoyed')`,
          alias: "annoyed",
        }),
    },
    {
      name: "eval_criteria",
      kind: "eval",
      judgement: { kind: "boolean", reads: "probability" },
      description:
        "The same judgement as `eval`, with the boundary spelled out: what counts as yes, then what does not.",
      parameters: [
        TEXT_KEY,
        INSTRUCTIONS,
        {
          name: "criteria",
          role: "option",
          type: "string[]",
          items: { min: 2, max: 2 },
          description:
            "Exactly two entries: what counts as yes, then what counts as no.",
        },
      ],
      keyKind: "text",
      returns: "Nullable(Float64)",
      encoding: "text",
      gates: [],
      example: (database) =>
        evalExample({
          database,
          call:
            `eval_criteria(${EXAMPLE_TEXT}, 'The customer sounds annoyed', ` +
            `['sarcasm, repetition or a raised voice count', 'a calm complaint does not count'])`,
          alias: "annoyed",
        }),
    },
    {
      name: "eval_passed",
      kind: "eval",
      judgement: { kind: "boolean", reads: "passed" },
      description:
        "The same judgement as `eval`, answered as 1 or 0 against a threshold you choose.",
      parameters: [
        TEXT_KEY,
        INSTRUCTIONS,
        {
          name: "threshold",
          role: "option",
          type: "number",
          numeric: { min: 0, max: 1, isInteger: false },
          description:
            "The probability at or above which the answer counts as yes, between 0 and 1.",
        },
      ],
      keyKind: "text",
      returns: "Nullable(UInt8)",
      encoding: "text",
      gates: [],
      example: (database) =>
        evalExample({
          database,
          call: `eval_passed(${EXAMPLE_TEXT}, 'The customer sounds annoyed', 0.7)`,
          alias: "annoyed",
        }),
    },
    {
      name: "eval_score",
      kind: "eval",
      judgement: { kind: "score", reads: "score" },
      description:
        "A rating on the whole-numbered scale you name, answered as the probability-weighted mean of the levels rather than the single most likely one.",
      parameters: [
        TEXT_KEY,
        INSTRUCTIONS,
        {
          name: "min",
          role: "option",
          type: "number",
          numeric: { min: -1_000, max: 1_000, isInteger: true },
          description: "The lowest level of the scale.",
        },
        {
          name: "max",
          role: "option",
          type: "number",
          numeric: { min: -1_000, max: 1_000, isInteger: true },
          description:
            "The highest level of the scale, above the lowest. A scale holds at most 10 levels, so the two ends may be at most 9 apart.",
        },
      ],
      keyKind: "text",
      returns: "Nullable(Float64)",
      encoding: "text",
      gates: [],
      example: (database) =>
        evalExample({
          database,
          call:
            `eval_score(${EXAMPLE_TEXT}, ` +
            `'How satisfied is the customer, from 1 for angry to 5 for delighted', 1, 5)`,
          alias: "satisfaction",
        }),
    },
    {
      name: "eval_category",
      kind: "eval",
      judgement: { kind: "category", reads: "label" },
      description:
        "The most likely option out of the ones you list, as its name.",
      parameters: [TEXT_KEY, INSTRUCTIONS, categoryOptions()],
      keyKind: "text",
      returns: "Nullable(String)",
      encoding: "text",
      gates: [],
      example: (database) =>
        evalExample({
          database,
          call: categoryCall("eval_category"),
          alias: "intent",
        }),
    },
    {
      name: "eval_category_probs",
      kind: "eval",
      judgement: { kind: "category", reads: "probabilities" },
      description:
        "The same judgement as `eval_category`, as a JSON object of option name to probability, for when the runner-up matters.",
      parameters: [TEXT_KEY, INSTRUCTIONS, categoryOptions()],
      keyKind: "text",
      returns: "Nullable(String)",
      encoding: "json",
      gates: [],
      example: (database) =>
        evalExample({
          database,
          call: categoryCall("eval_category_probs"),
          alias: "intent_probabilities",
        }),
    },
  ];

function categoryOptions(): LangWatchQLAppFunctionParameter {
  return {
    name: "options",
    role: "option",
    type: "string[]",
    items: { min: 2, max: 255, shape: "name-and-description" },
    description:
      "Between 2 and 255 options, each written as `name: what it means`. The name is what the column holds.",
  };
}

function categoryCall(name: string): string {
  return (
    `${name}(${EXAMPLE_TEXT}, 'What is the customer asking for', ` +
    `['refund: wants money back', 'bug: reports something broken', ` +
    `'question: wants information', 'other: anything else'])`
  );
}

/**
 * A case-insensitive test for any eval function name applied as a call.
 *
 * Built from the catalog so a new eval function is covered by adding it there.
 * `eval` being a prefix of the others is harmless: the pattern requires an open
 * parenthesis after the name, so `eval_criteria(` never matches the `eval`
 * branch.
 */
const EVAL_FUNCTION_MENTION = new RegExp(
  `\\b(${LWQL_EVAL_FUNCTION_CATALOG.map((definition) => definition.name).join(
    "|",
  )})\\s*\\(`,
  "i",
);

/**
 * Whether a statement could possibly call an eval function.
 *
 * A text test rather than a parse, and deliberately one-sided: a false positive
 * costs one flag lookup, a false negative would be a correctness bug, and a
 * statement that does not name any of these functions cannot call one. It
 * exists because resolving the gate means a project read and a flag evaluation,
 * and the overwhelming majority of statements judge nothing. The parse stays
 * single (ADR-083) — this reads the SQL as text and asks nothing of the parser.
 */
export function statementMightCallEvalFunction(sql: string): boolean {
  return EVAL_FUNCTION_MENTION.test(sql);
}

/** Whether a validated statement actually judges anything. */
export function callsEvalFunction(
  calls: readonly { readonly function: string }[],
): boolean {
  return calls.some((call) =>
    LWQL_EVAL_FUNCTION_CATALOG.some(
      (definition) => definition.name === call.function,
    ),
  );
}
