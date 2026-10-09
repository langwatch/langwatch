/**
 * LangWatchQL app functions — the declaration every other half reads.
 *
 * An app function is a name a caller writes in a LangWatchQL projection whose
 * value the *application* computes, not the database. ClickHouse holds a pure
 * projection UDF for each one (`../provisioning/appFunctionStatements.ts`), so
 * the submitted statement still runs verbatim and the returned column carries
 * the key; the application then replaces each key with the value it names
 * (`./hydrate.ts`).
 *
 * This module is the single declaration those two halves, the validator and the
 * schema endpoint all read. Adding a function here gives it its DDL, its
 * validator rules, its cap, its gates and its published signature at once;
 * there is nowhere else to remember.
 *
 * ## Why the names are a public API from the first deploy
 *
 * SQL UDFs in ClickHouse are **global and have no database namespace** —
 * `analytics.conversation(x)` is UNKNOWN_FUNCTION (measured on 25.8), and one
 * name serves every tenant on the server. So a name here is not scoped, not
 * versioned and not renameable without breaking saved statements. Adding one
 * also stakes a claim against a future ClickHouse builtin of the same name:
 * `CREATE OR REPLACE FUNCTION length AS (k) -> k` is refused with
 * FUNCTION_ALREADY_EXISTS (609), which is why provisioning reconciles the
 * declared names against `system.functions` rather than assuming.
 *
 * ## Keys, options, and the one function whose key is a pair
 *
 * A parameter is either a **key** — an expression, whose per-row value is what
 * the application resolves — or an **option**, which must be a literal so the
 * plan is a property of the statement rather than of the rows. The UDF body is
 * derived from the key parameters: the identity for a single key, `tuple(...)`
 * for `llm_messages_span`, whose key is `(trace_id, span_id)` and would
 * otherwise lose half of itself in the database.
 *
 * @see ../../../../../specs/lwql/app-functions.feature
 * @see dev/docs/adr/136-lwql-app-functions-identity-udfs.md
 */

import type { FieldProtection } from "../../../traces/projection/catalog";
import {
  type LangWatchQLJudgement,
  LWQL_EVAL_FUNCTION_CATALOG,
} from "./evalCatalog";

/**
 * What a function's key resolves to, which decides how it is fetched and
 * capped.
 *
 * `"text"` is the eval functions' own: their key is the text to judge, which
 * needs no read at all — it is either already in the column or computed by the
 * extraction function nested inside the call.
 */
export const LWQL_APP_FUNCTION_KEY_KINDS = [
  "trace",
  "thread",
  "span",
  "text",
] as const;

export type LangWatchQLAppFunctionKeyKind =
  (typeof LWQL_APP_FUNCTION_KEY_KINDS)[number];

/**
 * How the string a function returns is meant to be read.
 *
 * `"json"` marks a value whose payload is JSON, so a CLI writing JSONL can
 * parse it back into a real array instead of embedding a quoted blob.
 * `"text"` is prose — and is also the honest answer for `thread_traces`, whose
 * return type is already an array the transport carries structurally.
 */
export const LWQL_APP_FUNCTION_ENCODINGS = ["text", "json"] as const;

export type LangWatchQLAppFunctionEncoding =
  (typeof LWQL_APP_FUNCTION_ENCODINGS)[number];

/** One declared argument. */
export interface LangWatchQLAppFunctionParameter {
  readonly name: string;
  /**
   * `key` arguments are expressions the caller writes — a column, or anything
   * the policy already admits. `option` arguments must be literals: they steer
   * how the value is computed, and a value bound at run time would make the
   * hydration plan a property of the rows rather than of the statement.
   */
  readonly role: "key" | "option";
  /** What an option literal must be. Ignored for a key, which is any expression. */
  readonly type: "string" | "number" | "string[]";
  /**
   * Bounds for a numeric option. Absent means a positive whole number, which
   * is what every token budget is.
   */
  readonly numeric?: {
    readonly min: number;
    readonly max: number;
    readonly isInteger: boolean;
  };
  /**
   * Fewest characters a text option may carry.
   *
   * Absent means any text, including none: `conversation_bounded`'s
   * `until_trace_id` uses the empty string to mean "read the whole thread", so
   * emptiness is a value there rather than a mistake. A parameter whose empty
   * form would reach a model as an unasked question sets this to 1.
   */
  readonly minLength?: number;
  /**
   * Bounds for a list option, and whether its entries carry a shape.
   *
   * `"name-and-description"` is `name: what it means` — the spelling the
   * category options use, checked by the validator so a missing colon is
   * refused where it was written rather than reaching the judge as an option
   * with no gloss.
   */
  readonly items?: {
    readonly min: number;
    readonly max: number;
    readonly shape?: "name-and-description";
  };
  readonly description: string;
}

/** One app function, completely. */
export interface LangWatchQLAppFunctionDefinition {
  /** The name a caller writes, and the global ClickHouse function name. */
  readonly name: string;
  /**
   * Whether the value is read from a trace or judged by the classifier.
   *
   * The distinction the validator reads: an eval function may nest an
   * extraction function, nothing may nest an eval function, and an eval
   * function is gated on the Instant Evals flag as well as on its arguments.
   */
  readonly kind: "extraction" | "eval";
  /** How an eval function asks its question and reads its answer. */
  readonly judgement?: LangWatchQLJudgement;
  readonly description: string;
  /** Fixed arity, one signature. */
  readonly parameters: readonly LangWatchQLAppFunctionParameter[];
  readonly keyKind: LangWatchQLAppFunctionKeyKind;
  /** ClickHouse type of the hydrated column, which the result re-declares. */
  readonly returns: string;
  readonly encoding: LangWatchQLAppFunctionEncoding;
  /**
   * Permissions a caller must hold, all of them, to call it at all.
   *
   * Mirrors the column gates in `../catalog/types.ts`: a function returning
   * captured content is exactly as restricted as a column holding it, and a
   * caller who cannot read `CapturedInput` cannot read it through a function
   * either.
   */
  readonly gates: readonly FieldProtection[];
  /** A runnable statement, built with the deployment's LangWatchQL database. */
  readonly example: (database: string) => string;
}

/**
 * How many distinct keys of each kind one execution may hydrate.
 *
 * A ceiling rather than a page: a partial answer that looks complete is the
 * failure mode an analytics caller cannot detect, so the cap is a refusal
 * (`lwql_app_function_key_cap`) and paging past it is the caller's own
 * `LIMIT` plus a keyset predicate. The thread ceiling is far lower than the
 * trace one because a thread is many traces — 200 threads is already the
 * `LIMIT 1000` the thread read itself applies.
 */
export const LWQL_APP_FUNCTION_KEY_CAPS: Readonly<
  Record<LangWatchQLAppFunctionKeyKind, number>
> = {
  trace: 1_000,
  thread: 200,
  span: 1_000,
  // One classification per distinct text, and a synchronous query is a caller
  // waiting: a thousand of them at the platform's own rate is about ten
  // seconds, which is the ceiling the exploratory loop is built around.
  text: 1_000,
};

/** The default token budget the bounded functions document. */
const DEFAULT_BUDGET_TOKENS = 8_000;

const THREAD_KEY: LangWatchQLAppFunctionParameter = {
  name: "thread_key",
  role: "key",
  type: "string",
  description:
    "The conversation id, as `analytics.trace_metrics.ConversationId` reports it.",
};

const TRACE_KEY: LangWatchQLAppFunctionParameter = {
  name: "trace_id",
  role: "key",
  type: "string",
  description: "The trace id.",
};

function threadExample({
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

function traceExample({
  database,
  call,
  alias,
}: {
  database: string;
  call: string;
  alias: string;
}): string {
  return (
    `SELECT TraceId, ${call} AS ${alias}\n` +
    `FROM ${database}.traces\n` +
    `WHERE OccurredAt >= subtractDays(now(), 1)\n` +
    `ORDER BY OccurredAt DESC\n` +
    `LIMIT 20`
  );
}

/**
 * Every extraction function this API publishes.
 *
 * Read this list as the contract. The gates are the strictest reading of what
 * each value contains: `llm_output_messages` needs the input permission as
 * well as the output one because choosing *which* LLM span stands for the
 * trace is done by reading that span's input, so answering the question at all
 * involves reading the request side.
 */
const EXTRACTION_FUNCTIONS: readonly Omit<
  LangWatchQLAppFunctionDefinition,
  "kind"
>[] = [
  {
    name: "conversation",
    description:
      "The whole thread as one markdown transcript, the way the trace drawer renders it: the system prompt once, then one section per turn, with a marker where content was redacted.",
    parameters: [THREAD_KEY],
    keyKind: "thread",
    returns: "Nullable(String)",
    encoding: "text",
    gates: ["input", "output"],
    example: (database) =>
      threadExample({
        database,
        call: "conversation(ConversationId)",
        alias: "transcript",
      }),
  },
  {
    name: "conversation_bounded",
    description:
      "The same transcript under a token budget: the opening and closing turns are kept and a marker names how many turns were dropped from the middle. Pass an empty string for `until_trace_id` to read the whole thread.",
    parameters: [
      THREAD_KEY,
      {
        name: "max_tokens",
        role: "option",
        type: "number",
        description:
          "Token budget for the rendered transcript, estimated as bytes over four.",
      },
      {
        name: "until_trace_id",
        role: "option",
        type: "string",
        description:
          "Stop at this trace, inclusive, so a judgement reads only what the agent had seen. An empty string reads the whole thread.",
      },
    ],
    keyKind: "thread",
    returns: "Nullable(String)",
    encoding: "text",
    gates: ["input", "output"],
    example: (database) =>
      threadExample({
        database,
        call: `conversation_bounded(ConversationId, ${DEFAULT_BUDGET_TOKENS}, '')`,
        alias: "transcript",
      }),
  },
  {
    name: "thread_traces",
    description:
      "The thread's trace ids, oldest first. Carries no captured content, so it needs no content permission.",
    parameters: [THREAD_KEY],
    keyKind: "thread",
    returns: "Array(String)",
    encoding: "text",
    gates: [],
    example: (database) =>
      threadExample({
        database,
        call: "thread_traces(ConversationId)",
        alias: "trace_ids",
      }),
  },
  {
    name: "llm_readable_trace",
    description:
      "The trace as the online evaluators and the scenario judge read it: a span digest, cut to the token budget by keeping the structure and expanding the spans that failed, then the model calls, then the slowest.",
    parameters: [
      TRACE_KEY,
      {
        name: "max_tokens",
        role: "option",
        type: "number",
        description:
          "Token budget for the digest, estimated as bytes over four.",
      },
    ],
    keyKind: "trace",
    returns: "Nullable(String)",
    encoding: "text",
    gates: ["input", "output"],
    example: (database) =>
      traceExample({
        database,
        call: `llm_readable_trace(TraceId, ${DEFAULT_BUDGET_TOKENS})`,
        alias: "text",
      }),
  },
  {
    name: "llm_messages",
    description:
      "The chat messages of the trace's chosen LLM call, as JSON `{input, output}` — the same split the trace drawer's two panels show. Falls back to the trace's own captured input and output when no LLM span carries a conversation.",
    parameters: [TRACE_KEY],
    keyKind: "trace",
    returns: "Nullable(String)",
    encoding: "json",
    gates: ["input", "output"],
    example: (database) =>
      traceExample({
        database,
        call: "llm_messages(TraceId)",
        alias: "messages",
      }),
  },
  {
    name: "llm_input_messages",
    description:
      "Only the request side of `llm_messages`, as a JSON array: the conversation history the model was given on this turn.",
    parameters: [TRACE_KEY],
    keyKind: "trace",
    returns: "Nullable(String)",
    encoding: "json",
    gates: ["input"],
    example: (database) =>
      traceExample({
        database,
        call: "llm_input_messages(TraceId)",
        alias: "messages",
      }),
  },
  {
    name: "llm_output_messages",
    description:
      "Only the response side of `llm_messages`, as a JSON array: everything the agent did from the last request onwards, tool calls and results included.",
    parameters: [TRACE_KEY],
    keyKind: "trace",
    returns: "Nullable(String)",
    encoding: "json",
    gates: ["input", "output"],
    example: (database) =>
      traceExample({
        database,
        call: "llm_output_messages(TraceId)",
        alias: "messages",
      }),
  },
  {
    name: "llm_messages_span",
    description:
      "The chat messages of one named span rather than the trace's chosen one, as JSON `{input, output}`.",
    parameters: [
      TRACE_KEY,
      {
        name: "span_id",
        role: "key",
        type: "string",
        description: "The span id, as `analytics.spans.SpanId` reports it.",
      },
    ],
    keyKind: "span",
    returns: "Nullable(String)",
    encoding: "json",
    gates: ["input", "output"],
    example: (database) =>
      `SELECT TraceId, SpanId, llm_messages_span(TraceId, SpanId) AS messages\n` +
      `FROM ${database}.spans\n` +
      `WHERE StartTime >= subtractDays(now(), 1)\n` +
      `ORDER BY StartTime DESC\n` +
      `LIMIT 20`,
  },
  {
    name: "trace_json",
    description:
      "The whole trace as one JSON object, spans included — the export shape, for post-training data and for reading a trace outside the product.",
    parameters: [TRACE_KEY],
    keyKind: "trace",
    returns: "Nullable(String)",
    encoding: "json",
    gates: ["input", "output"],
    example: (database) =>
      traceExample({
        database,
        call: "trace_json(TraceId)",
        alias: "trace",
      }),
  },
];

/** The extraction functions, each carrying the kind this whole list shares. */
const LWQL_EXTRACTION_FUNCTION_CATALOG: readonly LangWatchQLAppFunctionDefinition[] =
  EXTRACTION_FUNCTIONS.map((definition) => ({
    ...definition,
    kind: "extraction" as const,
  }));

/**
 * Every app function, extraction and eval together.
 *
 * One list because everything downstream treats them alike: one DDL generator,
 * one validator rule set, one hydration stage, one schema section. Where they
 * differ, they differ by {@link LangWatchQLAppFunctionDefinition.kind}, which
 * is a fact about the function rather than about which array it came from.
 */
export const LWQL_APP_FUNCTION_CATALOG: readonly LangWatchQLAppFunctionDefinition[] =
  [...LWQL_EXTRACTION_FUNCTION_CATALOG, ...LWQL_EVAL_FUNCTION_CATALOG];

/** Every declared name, in catalog order. */
export function lwqlAppFunctionNames(
  functions: readonly LangWatchQLAppFunctionDefinition[] = LWQL_APP_FUNCTION_CATALOG,
): readonly string[] {
  return functions.map((definition) => definition.name);
}

/**
 * The definition for a name, or `undefined`.
 *
 * Matched case-insensitively. ClickHouse resolves a SQL UDF by its exact name,
 * so `CONVERSATION(x)` would be UNKNOWN_FUNCTION at the database — but the
 * validator refusing it as *not an app function* would then report
 * `FUNCTION_NOT_ALLOWED`, sending the caller to look for a name that is right
 * there in the schema. Recognising the spelling here is what lets the refusal
 * say the useful thing instead.
 */
export function lwqlAppFunction(
  name: string,
  functions: readonly LangWatchQLAppFunctionDefinition[] = LWQL_APP_FUNCTION_CATALOG,
): LangWatchQLAppFunctionDefinition | undefined {
  const wanted = name.trim().toLowerCase();
  return functions.find((definition) => definition.name === wanted);
}

/** Whether this name is an app function in any spelling. */
export function isLangWatchQLAppFunction(
  name: string,
  functions: readonly LangWatchQLAppFunctionDefinition[] = LWQL_APP_FUNCTION_CATALOG,
): boolean {
  return lwqlAppFunction(name, functions) !== undefined;
}

/** The key parameters, in order. Never empty. */
export function lwqlAppFunctionKeyParameters(
  definition: LangWatchQLAppFunctionDefinition,
): readonly LangWatchQLAppFunctionParameter[] {
  return definition.parameters.filter((parameter) => parameter.role === "key");
}

/** How many distinct keys of this function's kind one execution may hydrate. */
export function lwqlAppFunctionCap(
  definition: LangWatchQLAppFunctionDefinition,
): number {
  return LWQL_APP_FUNCTION_KEY_CAPS[definition.keyKind];
}

/** `conversation_bounded(thread_key, max_tokens, until_trace_id)`. */
export function lwqlAppFunctionSignature(
  definition: LangWatchQLAppFunctionDefinition,
): string {
  const parameters = definition.parameters
    .map((parameter) => parameter.name)
    .join(", ");
  return `${definition.name}(${parameters})`;
}
