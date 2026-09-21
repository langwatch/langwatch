/**
 * The shorthand, expanded into the one statement a run executes. Nothing
 * downstream knows one was used, and the target settles what a judged row is.
 *
 * @see specs/instant-evals/instant-eval-shorthand.feature
 */

import {
  INSTANT_EVAL_CLASSIFIER_LIMITS,
  INSTANT_EVAL_MAX_SHORTHAND_QUESTIONS,
  INSTANT_EVAL_SELECTION_PARAMETER,
  INSTANT_EVAL_DEFAULT_WINDOW_DAYS,
  INSTANT_EVAL_SHORTHAND_TEXT_BUDGET,
  InstantEvalQueryInvalidError,
  type InstantEvalQuestion,
  type InstantEvalShorthandInput,
  type InstantEvalShorthandQuestion,
  type InstantEvalTarget,
} from "@langwatch/instant-eval-contract";
import { Temporal, type Instant } from "@langwatch/time";

import {
  clickHouseDateTime64,
  sqlInteger,
  sqlNumber,
  sqlString,
  sqlStringArray,
} from "./instant-eval-sql.rules.ts";
import { instantEvalTextBudget } from "./instant-eval-token-budget.rules.ts";

/** A column name: a letter or underscore, then letters, digits or underscores. */
const QUESTION_ID_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** One projected column: the eval call and the name it lands under. */
export interface InstantEvalShorthandColumn {
  readonly id: string;
  /** The eval call, with the text expression already inside it. */
  readonly expression: string;
}

/**
 * The column each question becomes, over one shared text expression: several
 * eval functions over the same text are batched into one request per row,
 * which is what keeps a three-question run costing about what one costs.
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
    throw new InstantEvalQueryInvalidError({
      reason: "An Instant Eval needs at least one question to ask.",
      fields: ["questions"],
    });
  }
  if (questions.length > INSTANT_EVAL_MAX_SHORTHAND_QUESTIONS) {
    throw new InstantEvalQueryInvalidError({
      reason: `An Instant Eval asks at most ${INSTANT_EVAL_MAX_SHORTHAND_QUESTIONS} questions of one text, and this one asks ${questions.length}.`,
      fields: ["questions"],
    });
  }

  const taken = new Set(reservedColumns.map((column) => column.toLowerCase()));
  const columns: InstantEvalShorthandColumn[] = [];
  for (const [index, question] of questions.entries()) {
    const id = question.id ?? `q${index + 1}`;
    if (!QUESTION_ID_PATTERN.test(id)) {
      throw new InstantEvalQueryInvalidError({
        reason: `"${id}" cannot name a question: a name becomes a column, so it starts with a letter or an underscore and holds only letters, digits and underscores.`,
        fields: ["questions"],
      });
    }
    if (taken.has(id.toLowerCase())) {
      throw new InstantEvalQueryInvalidError({
        reason: `"${id}" is already the name of a column this statement projects (${reservedColumns.join(", ")}) or of another question. Pick another name.`,
        fields: ["questions"],
      });
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

const EVAL_CALL_BY_KIND: Readonly<
  Record<InstantEvalShorthandQuestion["kind"], (input: EvalCallInput) => string>
> = { boolean: booleanCall, score: scoreCall, category: categoryCall };

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
    throw new InstantEvalQueryInvalidError({
      reason:
        "A yes or no question takes criteria or a threshold, not both: criteria answer a probability with the boundary spelled out, a threshold answers a yes or no. Ask for one of the two.",
      fields: ["criteria", "threshold"],
    });
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
    throw new InstantEvalQueryInvalidError({
      reason: "A rating needs the two ends of its scale.",
      fields: ["range"],
    });
  }
  if (range.max <= range.min) {
    throw new InstantEvalQueryInvalidError({
      reason: `A scale runs upwards, and this one runs from ${range.min} to ${range.max}.`,
      fields: ["range"],
    });
  }
  const levels = range.max - range.min + 1;
  if (levels > INSTANT_EVAL_CLASSIFIER_LIMITS.maxScoreLevels) {
    throw new InstantEvalQueryInvalidError({
      reason: `A scale holds at most ${INSTANT_EVAL_CLASSIFIER_LIMITS.maxScoreLevels} levels, and ${range.min} to ${range.max} is ${levels}.`,
      fields: ["range"],
    });
  }
  return `eval_score(${text}, ${instructions}, ${sqlInteger(range.min)}, ${sqlInteger(range.max)})`;
}

function categoryCall({ question, text, instructions }: EvalCallInput): string {
  refuseForeignFields({ question, allowed: ["options"] });
  const options = question.options;
  if (!options || options.length < 2) {
    throw new InstantEvalQueryInvalidError({
      reason: "A choice needs at least two options to pick between.",
      fields: ["options"],
    });
  }
  for (const option of options) {
    if (option.name.includes(":")) {
      throw new InstantEvalQueryInvalidError({
        reason: `"${option.name}" cannot name an option: a name and its meaning are written either side of a colon, so the name itself holds none.`,
        fields: ["options"],
      });
    }
  }
  const entries = options.map((option) => `${option.name}: ${option.description}`);
  return `eval_category(${text}, ${instructions}, ${sqlStringArray(entries)})`;
}

const KIND_FIELDS = ["criteria", "threshold", "range", "options"] as const;

/**
 * Refuses a field belonging to another kind of question: a rating carrying a
 * threshold is a caller who meant to ask a yes or no question, and ignoring
 * it would answer a different question and charge for it.
 */
function refuseForeignFields({
  question,
  allowed,
}: {
  readonly question: InstantEvalShorthandQuestion;
  readonly allowed: readonly string[];
}): void {
  const foreign = KIND_FIELDS.filter(
    (field) => !allowed.includes(field) && question[field] !== undefined,
  );
  if (foreign.length === 0) return;
  throw new InstantEvalQueryInvalidError({
    reason: `A ${question.kind} question has no use for ${foreign.join(" or ")}.`,
    fields: [...foreign],
  });
}

/** The statement a shorthand became, with the values it bound. */
export interface ExpandedInstantEvalShorthand {
  readonly sql: string;
  readonly parameters: Readonly<Record<string, string | number | boolean | readonly string[]>>;
}

/** A trace filter already compiled against the LangWatchQL trace view. */
export interface CompiledInstantEvalFilter {
  readonly sql: string;
  readonly parameters: Readonly<Record<string, string | number | boolean>>;
}

/** How one target reads its rows. */
interface TargetTemplate {
  /** The view, unqualified. */
  readonly view: string;
  readonly timeColumn: string;
  readonly alias?: string;
  readonly projection: readonly string[];
  readonly conditions: readonly string[];
  readonly groupBy?: string;
  readonly orderBy: string;
  /** The extraction call whose value each question judges. */
  readonly text: (budgetTokens: number) => string;
  readonly filterPlacement: "inline" | "trace-subquery";
  /**
   * The view's own trace column, as a subquery's left-hand side must spell it:
   * ClickHouse resolves a WHERE identifier against the SELECT aliases first.
   */
  readonly filterTraceColumn?: string;
}

const TEMPLATES: Readonly<Record<InstantEvalTarget, TargetTemplate>> = {
  traces: {
    view: "traces",
    timeColumn: "OccurredAt",
    projection: ["TraceId", "Attributes['gen_ai.conversation.id'] AS ThreadId", "OccurredAt"],
    conditions: [],
    orderBy: "TraceId",
    text: (budget) => `llm_readable_trace(TraceId, ${sqlInteger(budget)})`,
    filterPlacement: "inline",
  },
  threads: {
    view: "trace_metrics",
    timeColumn: "m.OccurredAt",
    alias: "m",
    // Every reference is qualified because the projection reuses two of the
    // view's own column names, and an unqualified side is how an alias comes
    // to shadow the column it reads.
    projection: [
      "argMax(m.TraceId, m.OccurredAt) AS TraceId",
      "m.ConversationId AS ThreadId",
      "max(m.OccurredAt) AS OccurredAt",
    ],
    conditions: ["m.ConversationId != ''"],
    groupBy: "m.ConversationId",
    orderBy: "ThreadId",
    // Unbounded: the eval function cuts to whatever the judge's state leaves,
    // so an ordinary conversation reaches it whole.
    text: () => "conversation(m.ConversationId)",
    filterPlacement: "trace-subquery",
    filterTraceColumn: "m.TraceId",
  },
  llm_spans: {
    view: "spans",
    timeColumn: "StartTime",
    projection: ["TraceId", "SpanId", "StartTime AS OccurredAt"],
    conditions: ["SpanAttributes['langwatch.span.type'] = 'llm'"],
    orderBy: "TraceId, SpanId",
    text: () => "llm_messages_span(TraceId, SpanId)",
    filterPlacement: "trace-subquery",
  },
};

/** The output columns a target projects before its questions. */
function projectedColumns(template: TargetTemplate): readonly string[] {
  return template.projection.map((entry) => / AS (\w+)$/.exec(entry)?.[1] ?? entry);
}

/** The shorthand's questions as the judge would be asked them. */
function classifierQuestions(
  questions: readonly InstantEvalShorthandQuestion[],
): readonly InstantEvalQuestion[] {
  return questions.map((question, index): InstantEvalQuestion => {
    const id = question.id ?? `q${index + 1}`;
    if (question.kind === "score") {
      return {
        id,
        kind: "score",
        instructions: question.instructions,
        range: question.range ?? { min: 0, max: 1 },
      };
    }
    if (question.kind === "category") {
      return {
        id,
        kind: "category",
        instructions: question.instructions,
        options: question.options ?? [],
      };
    }
    return {
      id,
      kind: "boolean",
      instructions: question.instructions,
      ...(question.criteria
        ? { criteria: [question.criteria[0]!, question.criteria[1]!] as const }
        : {}),
    };
  });
}

/**
 * The token budget the extraction call is written with: the shipped default,
 * unless the questions are large enough that the judge's state would not hold
 * both, and a list that leaves nothing is refused here.
 */
function textBudgetFor(questions: readonly InstantEvalShorthandQuestion[]): number {
  const available = instantEvalTextBudget({ questions: classifierQuestions(questions) });
  if (available === 0) {
    throw new InstantEvalQueryInvalidError({
      reason:
        "These questions are too long to leave room for any text to judge. Shorten them, or ask fewer of them at once.",
      fields: ["questions"],
    });
  }
  return Math.min(INSTANT_EVAL_SHORTHAND_TEXT_BUDGET, available);
}

/** The window a shorthand judges, resolved to two absolute instants. */
export function instantEvalShorthandWindow({
  shorthand,
  now,
}: {
  readonly shorthand: Pick<InstantEvalShorthandInput, "start" | "end">;
  readonly now: Instant;
}): { readonly start: Instant; readonly end: Instant } {
  const end = shorthand.end ? Temporal.Instant.from(shorthand.end) : now;
  const start = shorthand.start
    ? Temporal.Instant.from(shorthand.start)
    : end.subtract({ hours: INSTANT_EVAL_DEFAULT_WINDOW_DAYS * 24 });
  if (Temporal.Instant.compare(start, end) >= 0) {
    throw new InstantEvalQueryInvalidError({
      reason: "The window runs backwards: its start is at or after its end.",
      fields: ["start", "end"],
    });
  }
  return { start, end };
}

/**
 * The type the window is bound as: the views' own precision, in UTC by name,
 * because the bound text carries no offset.
 */
const WINDOW_PARAMETER_TYPE = "DateTime64(3, 'UTC')";

function windowConditions(timeColumn: string): readonly string[] {
  return [
    `${timeColumn} >= {start_at:${WINDOW_PARAMETER_TYPE}}`,
    `${timeColumn} < {end_at:${WINDOW_PARAMETER_TYPE}}`,
  ];
}

/** The filter as a subquery over the trace view, time-bounded on its own. */
function traceSubquery({
  database,
  filterSql,
  traceColumn,
}: {
  readonly database: string;
  readonly filterSql: string;
  readonly traceColumn: string;
}): string {
  const where = [...windowConditions("OccurredAt"), `(${filterSql})`].join("\n    AND ");
  return (
    `${traceColumn} IN (\n` +
    `    SELECT TraceId\n` +
    `    FROM ${database}.traces\n` +
    `    WHERE ${where}\n` +
    `  )`
  );
}

export function expandInstantEvalShorthand({
  shorthand,
  database,
  now,
  filter,
  selection,
}: {
  readonly shorthand: InstantEvalShorthandInput;
  /** The database the LangWatchQL views live in. */
  readonly database: string;
  readonly now: Instant;
  /** The caller's filter, already compiled against the trace view. */
  readonly filter?: CompiledInstantEvalFilter | null;
  /**
   * The trace ids the filter selects, resolved by the caller when the filter
   * names a field the trace view cannot answer. When given, the statement
   * keeps these ids and nothing else.
   */
  readonly selection?: readonly string[];
}): ExpandedInstantEvalShorthand {
  const template = TEMPLATES[shorthand.target];
  const budget = textBudgetFor(shorthand.questions);
  const columns = instantEvalShorthandColumns({
    questions: shorthand.questions,
    text: template.text(budget),
    reservedColumns: projectedColumns(template),
  });

  const { start, end } = instantEvalShorthandWindow({ shorthand, now });
  const applied = selection ? null : (filter ?? null);

  const conditions = [...windowConditions(template.timeColumn), ...template.conditions];
  if (selection) {
    conditions.push(
      `${template.filterTraceColumn ?? "TraceId"} IN ({${INSTANT_EVAL_SELECTION_PARAMETER}:Array(String)})`,
    );
  } else if (applied) {
    conditions.push(
      template.filterPlacement === "inline"
        ? `(${applied.sql})`
        : traceSubquery({
            database,
            filterSql: applied.sql,
            traceColumn: template.filterTraceColumn ?? "TraceId",
          }),
    );
  }

  return {
    sql: renderStatement({ template, columns, conditions, database }),
    parameters: {
      start_at: clickHouseDateTime64(start),
      end_at: clickHouseDateTime64(end),
      ...applied?.parameters,
      ...(selection ? { [INSTANT_EVAL_SELECTION_PARAMETER]: [...selection] } : {}),
    },
  };
}

function renderStatement({
  template,
  columns,
  conditions,
  database,
}: {
  readonly template: TargetTemplate;
  readonly columns: readonly InstantEvalShorthandColumn[];
  readonly conditions: readonly string[];
  readonly database: string;
}): string {
  const projection = [
    ...template.projection,
    ...columns.map((column) => `${column.expression} AS ${column.id}`),
  ];
  const from = template.alias
    ? `${database}.${template.view} AS ${template.alias}`
    : `${database}.${template.view}`;
  return [
    `SELECT\n  ${projection.join(",\n  ")}`,
    `FROM ${from}`,
    `WHERE ${conditions.join("\n  AND ")}`,
    ...(template.groupBy ? [`GROUP BY ${template.groupBy}`] : []),
    `ORDER BY ${template.orderBy}`,
  ].join("\n");
}
