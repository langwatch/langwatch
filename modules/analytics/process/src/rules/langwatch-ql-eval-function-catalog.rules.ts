/**
 * The eval functions: the half of the catalog whose value is a judgement about
 * a text, which is why an eval call is the one place the validator allows
 * nesting. @see specs/lwql/eval-functions.feature
 */

import type {
  LangWatchQLAppFunctionDefinition,
  LangWatchQLAppFunctionParameter,
} from "./langwatch-ql-app-function-shapes.rules.ts";

/**
 * Most levels a score range may ask the judge to weigh — the judge's own
 * ceiling, stated here because the dependency runs judge → LangWatchQL, and
 * refusing the scale here turns one failed request per row into one message.
 */
export const LWQL_MAX_SCORE_LEVELS = 10;

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
  description: "The question, in your own words, as you would write it for a human reader.",
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
 * Every eval function published. None declares a content gate: the text is an
 * expression the walk already checked. One name is one arity — ClickHouse
 * refuses any other count — so the criteria form has its own name.
 */
export const LWQL_EVAL_FUNCTION_CATALOG: readonly LangWatchQLAppFunctionDefinition[] = [
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
        description: "Exactly two entries: what counts as yes, then what counts as no.",
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
    description: "The same judgement as `eval`, answered as 1 or 0 against a threshold you choose.",
    parameters: [
      TEXT_KEY,
      INSTRUCTIONS,
      {
        name: "threshold",
        role: "option",
        type: "number",
        numeric: { min: 0, max: 1, isInteger: false },
        description: "The probability at or above which the answer counts as yes, between 0 and 1.",
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
    description: "The most likely option out of the ones you list, as its name.",
    parameters: [TEXT_KEY, INSTRUCTIONS, categoryOptions()],
    keyKind: "text",
    returns: "Nullable(String)",
    encoding: "text",
    gates: [],
    example: (database) =>
      evalExample({ database, call: categoryCall("eval_category"), alias: "intent" }),
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

/**
 * A case-insensitive test for any eval function name applied as a call. `eval`
 * being a prefix of the others is harmless: the pattern requires an open
 * parenthesis, so `eval_criteria(` never matches the `eval` branch.
 */
const EVAL_FUNCTION_MENTION = new RegExp(
  `\\b(${LWQL_EVAL_FUNCTION_CATALOG.map((definition) => definition.name).join("|")})\\s*\\(`,
  "i",
);

/**
 * Whether a statement could possibly call an eval function: a text test, and
 * one-sided on purpose. A false positive costs one flag lookup; resolving the
 * gate means a project read, and most statements judge nothing.
 */
export function statementMightCallEvalFunction(sql: string): boolean {
  return EVAL_FUNCTION_MENTION.test(sql);
}

/**
 * Whether a name is one of the eval functions. Its caller is the position
 * refusal, whose advice differs by kind: an extraction function returns a
 * column you can go on to filter on, and an eval function does not.
 */
export function isEvalFunctionName(name: string): boolean {
  return LWQL_EVAL_FUNCTION_CATALOG.some((definition) => definition.name === name.toLowerCase());
}

/** Whether a validated statement actually judges anything. */
export function callsEvalFunction(calls: readonly { readonly function: string }[]): boolean {
  return calls.some((call) =>
    LWQL_EVAL_FUNCTION_CATALOG.some((definition) => definition.name === call.function),
  );
}
