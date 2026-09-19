/**
 * The shorthand, expanded into the one statement a run executes.
 *
 * A caller who has a question but not a statement names a target, a filter and
 * the questions; this writes the LangWatchQL, and the statement then goes
 * through exactly the gate a submitted one does. Nothing downstream knows a
 * shorthand was used: the run stores the statement, derives its questions from
 * it, pages it and hands it back. That is deliberate, and it is the reason the
 * expansion lives here rather than inside the run: the shorthand teaches the
 * primitive instead of standing beside it.
 *
 * ## The three targets
 *
 * A target settles what one judged row IS, and therefore which view the
 * statement reads, which extraction function renders the text, and what the
 * row is addressed by:
 *
 * | Target | One row is | Text from | Addressed by |
 * |---|---|---|---|
 * | `traces` | one trace | `llm_readable_trace` | the trace |
 * | `threads` | one conversation | `conversation` | its last trace |
 * | `llm_spans` | one model call | `llm_messages_span` | the trace and span |
 *
 * ## Where the filter goes
 *
 * The filter is a TRACE filter whatever the target, because that is the
 * language customers already write. Over `traces` it is a condition in the
 * statement's own WHERE. Over the other two it is a subquery on the trace view,
 * because neither the metrics view nor the span view carries the trace's
 * attributes: a conversation is kept when any of its traces matches, and a
 * model call is kept when its trace matches. Both subqueries bound their own
 * time column, so the filter is partition-pruned rather than scanned.
 *
 * ## Why the window is two bound instants and never `now()`
 *
 * A run executes its statement several times: once to count, then twice per
 * page. A window written as `subtractDays(now(), 7)` would move between those
 * executions, so the keyset pages would tile a selection that is not the one
 * that was counted. The window is resolved once, at expansion, and bound.
 *
 * @see ./filter.ts
 * @see ./questions.ts
 * @see ../run/statement.ts: the gate the result goes through
 * @see ../../../../../specs/instant-evals/instant-eval-shorthand.feature
 */

import { z } from "zod";

import type { InstantEvalQuestion } from "../classifier/classifier";
import { instantEvalTextBudget } from "../classifier/token-budget";
import { compileInstantEvalShorthandFilter } from "./filter";
import {
  INSTANT_EVAL_MAX_SHORTHAND_QUESTIONS,
  type InstantEvalShorthandColumn,
  InstantEvalShorthandError,
  type InstantEvalShorthandQuestion,
  instantEvalShorthandColumns,
  instantEvalShorthandQuestionSchema,
} from "./questions";
import { clickHouseDateTime64, sqlInteger } from "./sql";

/** What one judged row is. */
export const INSTANT_EVAL_TARGETS = ["traces", "threads", "llm_spans"] as const;

export type InstantEvalTarget = (typeof INSTANT_EVAL_TARGETS)[number];

/** The parameters the expansion binds the window under. */
export const INSTANT_EVAL_WINDOW_PARAMETERS = ["start_at", "end_at"] as const;

/**
 * The token budget the bounded extraction functions are called with.
 *
 * The same eight thousand the function catalog documents as its default, and
 * for the reason the cost study gives: a typical trace renders to well under
 * it, a coding session renders to many times it, and the difference in price
 * between cutting at eight thousand and cutting at the classifier's own
 * ceiling is a factor of four on exactly the rows that are least worth reading
 * in full. A caller who wants the whole thing writes the statement.
 */
export const INSTANT_EVAL_SHORTHAND_TEXT_BUDGET = 8_000;

/** How far back a shorthand looks when the caller names no window. */
export const INSTANT_EVAL_DEFAULT_WINDOW_DAYS = 7;

export const instantEvalShorthandSchema = z.object({
  target: z
    .enum(INSTANT_EVAL_TARGETS)
    .describe(
      "What one judged row is: a trace, a conversation, or one model call.",
    ),
  filter: z
    .string()
    .max(4_000)
    .optional()
    .describe(
      "A trace filter, in the language the trace explorer's search bar speaks, narrowing which rows are judged.",
    ),
  start: z
    .string()
    .datetime({ offset: true })
    .optional()
    .describe(
      "The oldest instant to judge, as an ISO 8601 timestamp. Defaults to seven days ago.",
    ),
  end: z
    .string()
    .datetime({ offset: true })
    .optional()
    .describe("The newest instant to judge. Defaults to now."),
  questions: z
    .array(instantEvalShorthandQuestionSchema)
    // Bounded here as well as in the column builder, so a list far over the
    // ceiling is refused by its own count rather than by the token budget that
    // many questions happen to leave.
    .min(1)
    .max(INSTANT_EVAL_MAX_SHORTHAND_QUESTIONS)
    .describe("What to ask of each row. One classification asks them all."),
});

export type InstantEvalShorthandInput = z.infer<
  typeof instantEvalShorthandSchema
>;

/** The statement a shorthand became, with the values it bound. */
export interface ExpandedInstantEvalShorthand {
  readonly sql: string;
  readonly parameters: Readonly<Record<string, string | number | boolean>>;
}

/** How one target reads its rows. */
interface TargetTemplate {
  /** The view, unqualified. */
  readonly view: string;
  /** Its time column. */
  readonly timeColumn: string;
  /** The table alias the template qualifies with, where it needs one. */
  readonly alias?: string;
  /** The key columns projected, in the order they are written. */
  readonly projection: readonly string[];
  /** Conditions the target always carries, beyond the window. */
  readonly conditions: readonly string[];
  readonly groupBy?: string;
  readonly orderBy: string;
  /** The extraction call whose value each question judges. */
  readonly text: (budgetTokens: number) => string;
  /** Whether the trace filter is a condition here or a subquery on the traces view. */
  readonly filterPlacement: "inline" | "trace-subquery";
  /**
   * The view's own trace column, as the subquery's left-hand side must spell
   * it. Not the projected name: ClickHouse resolves a WHERE identifier against
   * the SELECT aliases first, and `threads` projects `TraceId` as an aggregate,
   * which an unqualified `TraceId IN (...)` would pick up and be refused for.
   */
  readonly filterTraceColumn?: string;
}

const TEMPLATES: Readonly<Record<InstantEvalTarget, TargetTemplate>> = {
  traces: {
    view: "traces",
    timeColumn: "OccurredAt",
    projection: [
      "TraceId",
      "Attributes['gen_ai.conversation.id'] AS ThreadId",
      "OccurredAt",
    ],
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
    // view's own column names: `max(m.OccurredAt) AS OccurredAt` is one row's
    // worth of a column that also exists per trace, and leaving either side
    // unqualified is how an alias comes to shadow the column it reads.
    projection: [
      "argMax(m.TraceId, m.OccurredAt) AS TraceId",
      "m.ConversationId AS ThreadId",
      "max(m.OccurredAt) AS OccurredAt",
    ],
    conditions: ["m.ConversationId != ''"],
    groupBy: "m.ConversationId",
    // By conversation rather than by the trace the run pages on: the paging
    // key here is an aggregate, and its alias shares a name with the view's
    // own column. The run's own wrapper is what orders pages, and it reads the
    // projected TraceId.
    orderBy: "ThreadId",
    // Unbounded: the eval function cuts to whatever the classifier's state
    // leaves once the questions are in, which is about four times the shipped
    // eight thousand token default, so an ordinary conversation reaches the
    // judge whole. Ask for `conversation_bounded` in a statement of your own
    // to trade fidelity for price on long threads.
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
  return template.projection.map((entry) => {
    const aliased = / AS (\w+)$/.exec(entry);
    return aliased?.[1] ?? entry;
  });
}

/** The shorthand's questions as the classifier would be asked them. */
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
 * The token budget the extraction call is written with.
 *
 * The shipped default, unless the questions themselves are large enough that
 * the classifier's state would not hold both, in which case it is whatever
 * the questions leave, and a question list that leaves nothing is refused
 * here rather than by a failed request per row.
 */
function textBudgetFor(
  questions: readonly InstantEvalShorthandQuestion[],
): number {
  const available = instantEvalTextBudget({
    questions: classifierQuestions(questions),
  });
  if (available === null) {
    throw new InstantEvalShorthandError(
      "These questions are too long to leave room for any text to judge. Shorten them, or ask fewer of them at once.",
      ["questions"],
    );
  }
  return Math.min(INSTANT_EVAL_SHORTHAND_TEXT_BUDGET, available);
}

/** The window, resolved to two absolute instants. */
function windowFor({
  shorthand,
  now,
}: {
  readonly shorthand: InstantEvalShorthandInput;
  readonly now: Date;
}): { readonly startAt: string; readonly endAt: string } {
  const end = shorthand.end ? new Date(shorthand.end) : now;
  const start = shorthand.start
    ? new Date(shorthand.start)
    : new Date(
        end.getTime() - INSTANT_EVAL_DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1_000,
      );
  if (start.getTime() >= end.getTime()) {
    throw new InstantEvalShorthandError(
      "The window runs backwards: its start is at or after its end.",
      ["start", "end"],
    );
  }
  return {
    startAt: clickHouseDateTime64(start),
    endAt: clickHouseDateTime64(end),
  };
}

/** The type the window is bound as: the precision of the views' time columns. */
const WINDOW_PARAMETER_TYPE = "DateTime64(3)";

/** `<column> >= {start_at:DateTime64(3)} AND <column> < {end_at:DateTime64(3)}`. */
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
  const where = [...windowConditions("OccurredAt"), `(${filterSql})`].join(
    "\n    AND ",
  );
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
  now = new Date(),
}: {
  readonly shorthand: InstantEvalShorthandInput;
  /** The database the LangWatchQL views live in. */
  readonly database: string;
  readonly now?: Date;
}): ExpandedInstantEvalShorthand {
  const template = TEMPLATES[shorthand.target];
  const budget = textBudgetFor(shorthand.questions);
  const columns = instantEvalShorthandColumns({
    questions: shorthand.questions,
    text: template.text(budget),
    reservedColumns: projectedColumns(template),
  });

  const { startAt, endAt } = windowFor({ shorthand, now });
  const filter = compileInstantEvalShorthandFilter(shorthand.filter);

  const conditions = [
    ...windowConditions(template.timeColumn),
    ...template.conditions,
  ];
  if (filter) {
    conditions.push(
      template.filterPlacement === "inline"
        ? `(${filter.sql})`
        : traceSubquery({
            database,
            filterSql: filter.sql,
            traceColumn: template.filterTraceColumn ?? "TraceId",
          }),
    );
  }

  return {
    sql: renderStatement({ template, columns, conditions, database }),
    parameters: {
      start_at: startAt,
      end_at: endAt,
      ...(filter?.parameters ?? {}),
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
