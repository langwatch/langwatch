/**
 * What a shorthand asks, and the eval call each question becomes.
 *
 * A run's questions are read off its statement (`../run/questions.ts`), and
 * that does not change here: the shorthand's job is to WRITE the statement, so
 * a question in this vocabulary is translated into the eval function that asks
 * it and then forgotten. Everything downstream (the stored questions, the
 * counters, the judgement rows) is derived from the statement, so a run
 * started from a shorthand and a run started from the equivalent statement are
 * the same run.
 *
 * The vocabulary is the one the evaluators already use: `instructions` is the
 * prompt, `options` are the categories, `range` is the scale. What it adds is a
 * `threshold`, because the judge answers a calibrated probability and the line
 * between yes and no is the caller's to draw.
 *
 * ## The four boolean spellings, and why one pair cannot be combined
 *
 * `eval` answers a probability. `eval_criteria` answers the same probability
 * with the boundary spelled out. `eval_passed` answers a yes or no against a
 * threshold. There is no function that takes criteria AND a threshold, because
 * a ClickHouse SQL UDF is a lambda with a fixed parameter list and cannot be
 * overloaded, so every combination of arguments is its own name. A question
 * carrying both is therefore refused with both names in the message rather than
 * silently dropping one of the two.
 *
 * @see ../../../analytics/lwql/appFunctions/evalCatalog.ts: the functions
 * @see ../run/questions.ts: how they are read back off the statement
 * @see ../../../../../specs/instant-evals/instant-eval-shorthand.feature
 */

import { z } from "zod";

import { INSTANT_EVAL_CLASSIFIER_LIMITS } from "../classifier/token-budget";
import { sqlInteger, sqlNumber, sqlString, sqlStringArray } from "./sql";

/** The longest a question's own name may be, which is a column name. */
const MAX_QUESTION_ID_LENGTH = 64;

/** A column name: a letter or underscore, then letters, digits or underscores. */
const QUESTION_ID_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Questions one shorthand may ask. */
export const INSTANT_EVAL_MAX_SHORTHAND_QUESTIONS = 10;

/**
 * A string carrying something other than whitespace.
 *
 * `min(1)` alone accepts a run of spaces, and a question whose instructions
 * are three spaces reaches the classifier as an empty prompt and is billed
 * like any other.
 */
const written = (
  schema: z.ZodString,
): z.ZodEffects<z.ZodString, string, string> =>
  schema.refine((value) => value.trim().length > 0, {
    message: "Write something other than whitespace.",
  });

/** One named option of a category question. */
export const instantEvalShorthandOptionSchema = z.object({
  name: written(z.string().min(1).max(100)).describe(
    "What the column holds when this option is the answer.",
  ),
  description: written(z.string().min(1).max(500)).describe(
    "What this option means, in your own words.",
  ),
});

export const instantEvalShorthandQuestionSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(MAX_QUESTION_ID_LENGTH)
    .optional()
    .describe(
      "What to call this question. It becomes the statement's output column and the name every judgement is filed under. Defaults to q1, q2 and so on.",
    ),
  kind: z
    .enum(["boolean", "score", "category"])
    .optional()
    .default("boolean")
    .describe(
      "What kind of answer you want: a yes or no, a rating on a scale, or one of a list of options.",
    ),
  instructions: written(z.string().min(1).max(2_000)).describe(
    "The question, in your own words, as you would write it for a human reader.",
  ),
  criteria: z
    .array(written(z.string().min(1).max(500)))
    .length(2)
    .optional()
    .describe(
      "For a yes or no question: what counts as yes, then what counts as no. Cannot be combined with a threshold.",
    ),
  threshold: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe(
      "For a yes or no question: the probability at or above which the answer counts as yes. Without one the column carries the probability itself and a run draws the line at an even chance.",
    ),
  range: z
    .object({
      min: z.number().int().describe("The lowest level of the scale."),
      max: z.number().int().describe("The highest level of the scale."),
    })
    .optional()
    .describe("For a rating: the two ends of the scale."),
  options: z
    .array(instantEvalShorthandOptionSchema)
    .min(2)
    .max(INSTANT_EVAL_CLASSIFIER_LIMITS.maxCategoryOptions)
    .optional()
    .describe("For a choice: the options to pick between."),
});

export type InstantEvalShorthandQuestion = z.infer<
  typeof instantEvalShorthandQuestionSchema
>;

/** The reason a question cannot be written as an eval call. */
export class InstantEvalShorthandError extends Error {
  constructor(
    message: string,
    readonly fields: readonly string[] = [],
  ) {
    super(message);
    this.name = "InstantEvalShorthandError";
  }
}

/** One projected column: the eval call and the name it lands under. */
export interface InstantEvalShorthandColumn {
  readonly id: string;
  /** The eval call, with the text expression already inside it. */
  readonly expression: string;
}

/**
 * The column each question becomes, with the text expression judged.
 *
 * `text` is the extraction call the target chose, written once and shared by
 * every question: several eval functions over the same text in one statement
 * are batched into one classifier request per row, which is what keeps a
 * three-question run costing about what a one-question run does.
 */
export function instantEvalShorthandColumns({
  questions,
  text,
  reservedColumns,
}: {
  readonly questions: readonly InstantEvalShorthandQuestion[];
  readonly text: string;
  /** The key columns the statement already projects, which an id may not take. */
  readonly reservedColumns: readonly string[];
}): readonly InstantEvalShorthandColumn[] {
  if (questions.length === 0) {
    throw new InstantEvalShorthandError(
      "An Instant Eval needs at least one question to ask.",
      ["questions"],
    );
  }
  if (questions.length > INSTANT_EVAL_MAX_SHORTHAND_QUESTIONS) {
    throw new InstantEvalShorthandError(
      `An Instant Eval asks at most ${INSTANT_EVAL_MAX_SHORTHAND_QUESTIONS} questions of one text, and this one asks ${questions.length}.`,
      ["questions"],
    );
  }

  const taken = new Set(reservedColumns.map((column) => column.toLowerCase()));
  const columns: InstantEvalShorthandColumn[] = [];
  for (const [index, question] of questions.entries()) {
    const id = question.id ?? `q${index + 1}`;
    if (!QUESTION_ID_PATTERN.test(id)) {
      throw new InstantEvalShorthandError(
        `"${id}" cannot name a question: a name becomes a column, so it starts with a letter or an underscore and holds only letters, digits and underscores.`,
        ["questions"],
      );
    }
    if (taken.has(id.toLowerCase())) {
      throw new InstantEvalShorthandError(
        `"${id}" is already the name of a column this statement projects (${reservedColumns.join(", ")}) or of another question. Pick another name.`,
        ["questions"],
      );
    }
    taken.add(id.toLowerCase());
    columns.push({ id, expression: evalCallFor({ question, text }) });
  }
  return columns;
}

/** What every kind's call writer is handed. */
interface EvalCallInput {
  readonly question: InstantEvalShorthandQuestion;
  readonly text: string;
  /** The instructions, already written as a string literal. */
  readonly instructions: string;
}

/** The call writer for each kind of question. */
const EVAL_CALL_BY_KIND: Readonly<
  Record<InstantEvalShorthandQuestion["kind"], (input: EvalCallInput) => string>
> = {
  boolean: booleanCall,
  score: scoreCall,
  category: categoryCall,
};

/** The eval call one question is asked by. */
function evalCallFor({
  question,
  text,
}: {
  readonly question: InstantEvalShorthandQuestion;
  readonly text: string;
}): string {
  const instructions = sqlString(question.instructions);
  return EVAL_CALL_BY_KIND[question.kind]({ question, text, instructions });
}

function booleanCall({ question, text, instructions }: EvalCallInput): string {
  refuseForeignFields({ question, allowed: ["criteria", "threshold"] });
  if (question.criteria && question.threshold !== undefined) {
    throw new InstantEvalShorthandError(
      "A yes or no question takes criteria or a threshold, not both: criteria answer a probability with the boundary spelled out, a threshold answers a yes or no. Ask for one of the two.",
      ["criteria", "threshold"],
    );
  }
  if (question.criteria) {
    return `eval_criteria(${text}, ${instructions}, ${sqlStringArray(question.criteria)})`;
  }
  if (question.threshold !== undefined) {
    return `eval_passed(${text}, ${instructions}, ${sqlNumber(question.threshold)})`;
  }
  return `eval(${text}, ${instructions})`;
}

function scoreCall({ question, text, instructions }: EvalCallInput): string {
  refuseForeignFields({ question, allowed: ["range"] });
  const range = question.range;
  if (!range) {
    throw new InstantEvalShorthandError(
      "A rating needs the two ends of its scale.",
      ["range"],
    );
  }
  if (range.max <= range.min) {
    throw new InstantEvalShorthandError(
      `A scale runs upwards, and this one runs from ${range.min} to ${range.max}.`,
      ["range"],
    );
  }
  const levels = range.max - range.min + 1;
  if (levels > INSTANT_EVAL_CLASSIFIER_LIMITS.maxScoreLevels) {
    throw new InstantEvalShorthandError(
      `A scale holds at most ${INSTANT_EVAL_CLASSIFIER_LIMITS.maxScoreLevels} levels, and ${range.min} to ${range.max} is ${levels}.`,
      ["range"],
    );
  }
  return `eval_score(${text}, ${instructions}, ${sqlInteger(range.min)}, ${sqlInteger(range.max)})`;
}

function categoryCall({ question, text, instructions }: EvalCallInput): string {
  refuseForeignFields({ question, allowed: ["options"] });
  const options = question.options;
  if (!options || options.length < 2) {
    throw new InstantEvalShorthandError(
      "A choice needs at least two options to pick between.",
      ["options"],
    );
  }
  for (const option of options) {
    if (option.name.includes(":")) {
      throw new InstantEvalShorthandError(
        `"${option.name}" cannot name an option: a name and its meaning are written either side of a colon, so the name itself holds none.`,
        ["options"],
      );
    }
  }
  const entries = options.map(
    (option) => `${option.name}: ${option.description}`,
  );
  return `eval_category(${text}, ${instructions}, ${sqlStringArray(entries)})`;
}

/** Every field a question of this kind has no use for. */
const KIND_FIELDS = ["criteria", "threshold", "range", "options"] as const;

/**
 * Refuses a field belonging to another kind of question.
 *
 * A rating carrying a threshold is a caller who meant to ask a yes or no
 * question, and expanding it into a statement that ignores the threshold would
 * answer a different question than the one they wrote and charge them for it.
 */
function refuseForeignFields({
  question,
  allowed,
}: {
  readonly question: InstantEvalShorthandQuestion;
  readonly allowed: readonly string[];
}): void {
  const foreign = KIND_FIELDS.filter(
    (field) =>
      !allowed.includes(field) &&
      (question as Record<string, unknown>)[field] !== undefined,
  );
  if (foreign.length === 0) return;
  throw new InstantEvalShorthandError(
    `A ${question.kind} question has no use for ${foreign.join(" or ")}.`,
    [...foreign],
  );
}
