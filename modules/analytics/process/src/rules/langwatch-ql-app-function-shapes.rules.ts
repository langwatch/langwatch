/**
 * What an app function is, as a shape: a name a caller writes in a projection
 * whose value the application computes after the query, not the database.
 * @see specs/lwql/app-functions.feature
 */

import type { LangWatchQLJudgement } from "@langwatch/analytics-contract";

import type { FieldProtection } from "./lwql-field-protection.rules.ts";

/**
 * What a function's key resolves to, which decides how it is fetched and
 * capped. `text` is the eval functions' own: the key is the text to judge,
 * which needs no read at all.
 */
export const LWQL_APP_FUNCTION_KEY_KINDS = ["trace", "thread", "span", "text"] as const;

export type LangWatchQLAppFunctionKeyKind = (typeof LWQL_APP_FUNCTION_KEY_KINDS)[number];

/**
 * How the string a function returns is meant to be read: `json` marks a
 * payload a CLI writing JSONL can parse back into a real array.
 */
export const LWQL_APP_FUNCTION_ENCODINGS = ["text", "json"] as const;

export type LangWatchQLAppFunctionEncoding = (typeof LWQL_APP_FUNCTION_ENCODINGS)[number];

/** One declared argument. */
export interface LangWatchQLAppFunctionParameter {
  readonly name: string;
  /**
   * A `key` is an expression the caller writes; an `option` must be a literal,
   * so the hydration plan is a property of the statement, not of the rows.
   */
  readonly role: "key" | "option";
  /** What an option literal must be. Ignored for a key, which is any expression. */
  readonly type: "string" | "number" | "string[]";
  /** Bounds for a numeric option. Absent means a positive whole number. */
  readonly numeric?: {
    readonly min: number;
    readonly max: number;
    readonly isInteger: boolean;
  };
  /**
   * Fewest characters a text option may carry. Absent means any text,
   * including none — `conversation_bounded`'s `until_trace_id` reads the whole
   * thread when it is empty.
   */
  readonly minLength?: number;
  /**
   * Bounds for a list option. `name-and-description` is `name: what it means`,
   * the spelling the category options use, so a missing colon is refused where
   * it was written rather than reaching the judge as an option with no gloss.
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
   * Whether the value is read from a trace or judged by the classifier: an
   * eval function may nest an extraction function, nothing may nest an eval
   * function, and an eval function is gated on Instant Evals as well.
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
   * Permissions a caller must hold, all of them, to call it at all: a function
   * returning captured content is as restricted as a column holding it.
   */
  readonly gates: readonly FieldProtection[];
  /** A runnable statement, built with the deployment's LangWatchQL database. */
  readonly example: (database: string) => string;
}

/**
 * How many distinct keys of each kind one execution may hydrate. A refusal
 * rather than a page, because a partial answer that looks complete is what an
 * analytics caller cannot detect; paging past it is the caller's own `LIMIT`.
 */
export const LWQL_APP_FUNCTION_KEY_CAPS: Readonly<Record<LangWatchQLAppFunctionKeyKind, number>> = {
  trace: 1_000,
  thread: 200,
  span: 1_000,
  // One classification per distinct text, and a synchronous query is a caller
  // waiting: a thousand at the platform's own rate is about ten seconds.
  text: 1_000,
};

/** The widest cap any kind of key carries, which bounds nothing in practice. */
export const LWQL_WIDEST_APP_FUNCTION_KEY_CAP = Math.max(
  ...Object.values(LWQL_APP_FUNCTION_KEY_CAPS),
);

/** The default token budget the bounded functions document. */
export const LWQL_DEFAULT_BUDGET_TOKENS = 8_000;

export const LWQL_THREAD_KEY_PARAMETER: LangWatchQLAppFunctionParameter = {
  name: "thread_key",
  role: "key",
  type: "string",
  description: "The conversation id, as `analytics.trace_metrics.ConversationId` reports it.",
};

export const LWQL_TRACE_KEY_PARAMETER: LangWatchQLAppFunctionParameter = {
  name: "trace_id",
  role: "key",
  type: "string",
  description: "The trace id.",
};

/** A thread-keyed example statement, which every thread function publishes. */
export function lwqlThreadExample({
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

/** A trace-keyed example statement. */
export function lwqlTraceExample({
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
