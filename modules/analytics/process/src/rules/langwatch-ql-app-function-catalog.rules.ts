/**
 * The app functions: the one declaration the DDL, the validator, hydration and
 * the schema endpoint read. A name here is global in ClickHouse, so it is a
 * public API from the first deploy. @see specs/lwql/app-functions.feature
 */

import type { LangWatchQLAppFunctionCall } from "@langwatch/analytics-contract";

import {
  LWQL_APP_FUNCTION_KEY_CAPS,
  LWQL_WIDEST_APP_FUNCTION_KEY_CAP,
  LWQL_DEFAULT_BUDGET_TOKENS,
  LWQL_THREAD_KEY_PARAMETER,
  LWQL_TRACE_KEY_PARAMETER,
  type LangWatchQLAppFunctionDefinition,
  type LangWatchQLAppFunctionParameter,
  lwqlThreadExample,
  lwqlTraceExample,
} from "./langwatch-ql-app-function-shapes.rules.ts";
import { LWQL_EVAL_FUNCTION_CATALOG } from "./langwatch-ql-eval-function-catalog.rules.ts";

/**
 * Every extraction function published, gated by the strictest reading of what
 * it contains: `llm_output_messages` needs the input permission too, because
 * choosing which LLM span stands for the trace reads that span's input.
 */
const EXTRACTION_FUNCTIONS: readonly Omit<LangWatchQLAppFunctionDefinition, "kind">[] = [
  {
    name: "conversation",
    description:
      "The whole thread as one markdown transcript, the way the trace drawer renders it: the system prompt once, then one section per turn, with a marker where content was redacted.",
    parameters: [LWQL_THREAD_KEY_PARAMETER],
    keyKind: "thread",
    returns: "Nullable(String)",
    encoding: "text",
    gates: ["input", "output"],
    example: (database) =>
      lwqlThreadExample({
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
      LWQL_THREAD_KEY_PARAMETER,
      {
        name: "max_tokens",
        role: "option",
        type: "number",
        description: "Token budget for the rendered transcript, estimated as bytes over four.",
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
      lwqlThreadExample({
        database,
        call: `conversation_bounded(ConversationId, ${LWQL_DEFAULT_BUDGET_TOKENS}, '')`,
        alias: "transcript",
      }),
  },
  {
    name: "thread_traces",
    description:
      "The thread's trace ids, oldest first. Carries no captured content, so it needs no content permission.",
    parameters: [LWQL_THREAD_KEY_PARAMETER],
    keyKind: "thread",
    returns: "Array(String)",
    encoding: "text",
    gates: [],
    example: (database) =>
      lwqlThreadExample({
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
      LWQL_TRACE_KEY_PARAMETER,
      {
        name: "max_tokens",
        role: "option",
        type: "number",
        description: "Token budget for the digest, estimated as bytes over four.",
      },
    ],
    keyKind: "trace",
    returns: "Nullable(String)",
    encoding: "text",
    gates: ["input", "output"],
    example: (database) =>
      lwqlTraceExample({
        database,
        call: `llm_readable_trace(TraceId, ${LWQL_DEFAULT_BUDGET_TOKENS})`,
        alias: "text",
      }),
  },
  {
    name: "llm_messages",
    description:
      "The chat messages of the trace's chosen LLM call, as JSON `{input, output}` — the same split the trace drawer's two panels show. Falls back to the trace's own captured input and output when no LLM span carries a conversation.",
    parameters: [LWQL_TRACE_KEY_PARAMETER],
    keyKind: "trace",
    returns: "Nullable(String)",
    encoding: "json",
    gates: ["input", "output"],
    example: (database) =>
      lwqlTraceExample({ database, call: "llm_messages(TraceId)", alias: "messages" }),
  },
  {
    name: "llm_input_messages",
    description:
      "Only the request side of `llm_messages`, as a JSON array: the conversation history the model was given on this turn.",
    parameters: [LWQL_TRACE_KEY_PARAMETER],
    keyKind: "trace",
    returns: "Nullable(String)",
    encoding: "json",
    gates: ["input"],
    example: (database) =>
      lwqlTraceExample({
        database,
        call: "llm_input_messages(TraceId)",
        alias: "messages",
      }),
  },
  {
    name: "llm_output_messages",
    description:
      "Only the response side of `llm_messages`, as a JSON array: everything the agent did from the last request onwards, tool calls and results included.",
    parameters: [LWQL_TRACE_KEY_PARAMETER],
    keyKind: "trace",
    returns: "Nullable(String)",
    encoding: "json",
    gates: ["input", "output"],
    example: (database) =>
      lwqlTraceExample({
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
      LWQL_TRACE_KEY_PARAMETER,
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
    parameters: [LWQL_TRACE_KEY_PARAMETER],
    keyKind: "trace",
    returns: "Nullable(String)",
    encoding: "json",
    gates: ["input", "output"],
    example: (database) =>
      lwqlTraceExample({ database, call: "trace_json(TraceId)", alias: "trace" }),
  },
];

/** The extraction functions, each carrying the kind this whole list shares. */
const LWQL_EXTRACTION_FUNCTION_CATALOG: readonly LangWatchQLAppFunctionDefinition[] =
  EXTRACTION_FUNCTIONS.map((definition) => ({ ...definition, kind: "extraction" as const }));

/**
 * Extraction and eval together: one DDL generator, one validator rule set, one
 * hydration stage, one schema section. Where they differ they differ by
 * `kind`, a fact about the function rather than about which array it came from.
 */
export const LWQL_APP_FUNCTION_CATALOG: readonly LangWatchQLAppFunctionDefinition[] = [
  ...LWQL_EXTRACTION_FUNCTION_CATALOG,
  ...LWQL_EVAL_FUNCTION_CATALOG,
];

/** Every declared name, in catalog order. */
export function lwqlAppFunctionNames(
  functions: readonly LangWatchQLAppFunctionDefinition[] = LWQL_APP_FUNCTION_CATALOG,
): readonly string[] {
  return functions.map((definition) => definition.name);
}

/**
 * The definitions a name matches — one or none, matched case-insensitively.
 * ClickHouse resolves a SQL UDF by its exact name, but refusing `CONVERSATION`
 * as not-an-app-function would send a caller hunting for a name in the schema.
 */
export function findLangWatchQLAppFunctions(
  name: string,
  functions: readonly LangWatchQLAppFunctionDefinition[] = LWQL_APP_FUNCTION_CATALOG,
): readonly LangWatchQLAppFunctionDefinition[] {
  const wanted = name.trim().toLowerCase();
  return functions.filter((definition) => definition.name === wanted);
}

/** Whether this name is an app function in any spelling. */
export function isLangWatchQLAppFunction(
  name: string,
  functions: readonly LangWatchQLAppFunctionDefinition[] = LWQL_APP_FUNCTION_CATALOG,
): boolean {
  return findLangWatchQLAppFunctions(name, functions).length > 0;
}

/** The key parameters, in order. Never empty. */
export function lwqlAppFunctionKeyParameters(
  definition: LangWatchQLAppFunctionDefinition,
): readonly LangWatchQLAppFunctionParameter[] {
  return definition.parameters.filter((parameter) => parameter.role === "key");
}

/** How many distinct keys of this function's kind one execution may hydrate. */
export function lwqlAppFunctionCap(definition: LangWatchQLAppFunctionDefinition): number {
  return LWQL_APP_FUNCTION_KEY_CAPS[definition.keyKind];
}

/** `conversation_bounded(thread_key, max_tokens, until_trace_id)`. */
export function lwqlAppFunctionSignature(definition: LangWatchQLAppFunctionDefinition): string {
  const parameters = definition.parameters.map((parameter) => parameter.name).join(", ");
  return `${definition.name}(${parameters})`;
}

/**
 * The keys one execution of these calls may hydrate: every call's cap holds at
 * once, so the lowest wins. A plan naming no catalogued function is bound only
 * by the widest published cap, which is what a caller sizing a page reads.
 */
export function lwqlHydrationKeyCap(
  calls: readonly LangWatchQLAppFunctionCall[],
  functions: readonly LangWatchQLAppFunctionDefinition[] = LWQL_APP_FUNCTION_CATALOG,
): number {
  const caps = calls
    .flatMap((call) => [call.function, call.source?.function])
    .filter((name): name is string => typeof name === "string")
    .flatMap((name) => findLangWatchQLAppFunctions(name, functions).map(lwqlAppFunctionCap));

  return caps.length === 0 ? LWQL_WIDEST_APP_FUNCTION_KEY_CAP : Math.min(...caps);
}
