/**
 * The trace filter, compiled into LangWatchQL rather than resolved into ids.
 *
 * ## Why this is a second dialect and not a reuse of the trace compiler
 *
 * `translateFilterToClickHouse` compiles the same language, and its output
 * cannot be used here. It targets the base tables (`trace_summaries` for the
 * trace's own columns and partition-pruned subqueries over `stored_spans`,
 * `evaluation_runs` and `simulation_runs` for everything else) and it binds
 * `{tenantId:String}` itself. A statement a caller runs speaks to the
 * LangWatchQL views under a restricted identity that cannot see any of those
 * tables, and does not need to bind a tenant because the row policy is what
 * scopes it. Inlining that SQL would produce a statement the query policy
 * refuses on the first table name.
 *
 * Resolving the filter into a list of trace ids and binding them instead was
 * the other option, and it is worse in three ways: a hundred thousand ids is
 * three megabytes of statement or of parameter, the run's parameters are
 * scalars by contract, and the statement handed back would no longer be one a
 * caller could rerun, which is the whole point of handing it back. So the
 * filter is compiled, and the compilation is bounded by what the trace view can
 * answer.
 *
 * ## What that costs
 *
 * The LangWatchQL trace view carries the trace's own columns and its attribute
 * map, and nothing about spans, evaluations, events or scenario runs. So about
 * half the filter language compiles here and the other half is refused BY NAME,
 * with the statement door named as the way to ask it. A refusal that names the
 * field is a caller who writes one more line; a shorthand that quietly dropped
 * a condition is a caller who is charged for judging rows they excluded.
 *
 * The boolean structure (AND, OR, NOT, parentheses, the node ceiling) is the
 * language's, not the dialect's, so it is shared with the trace compiler
 * through `translateFilterAst`.
 *
 * @see ~/server/app-layer/traces/filter-to-clickhouse/ast.ts
 * @see ../../../../../specs/instant-evals/instant-eval-shorthand.feature
 */

import type { TagToken } from "liqe";

import { TRACE_ORIGIN_CLICKHOUSE_EXPRESSION } from "~/server/app-layer/traces/derive-trace-origin";
import {
  FilterFieldUnknownError,
  FilterParseError,
} from "~/server/app-layer/traces/errors";
import {
  type FilterTagTranslator,
  translateFilterAst,
} from "~/server/app-layer/traces/filter-to-clickhouse";
import {
  translateNumericField,
  translateStringField,
} from "~/server/app-layer/traces/filter-to-clickhouse/generic-translators";
import {
  extractStringValue,
  nextParam,
  TRACE_ATTRIBUTE_PREFIX,
  TRACE_ATTRIBUTE_PREFIX_LEGACY,
  type TranslationContext,
  validateAttributeKey,
  validateValueLength,
  wrap,
} from "~/server/app-layer/traces/filter-to-clickhouse/value-helpers";
import { InstantEvalShorthandError } from "./questions";

/** A field answered by comparing one expression to a string. */
interface StringFieldDialect {
  /** The expression, over the LangWatchQL trace view. */
  readonly expression: string;
  /** The parameter name the value is bound under, for a readable statement. */
  readonly param: string;
  /**
   * The facet whose registry expression this one has to equal.
   *
   * Set wherever the trace compiler's own expression is already valid over the
   * view, which is what a drift test asserts: the two surfaces then cannot
   * answer the same field differently. Absent where the dialect deliberately
   * differs, and the difference is stated on the field.
   */
  readonly facetKey?: string;
}

/** A field answered by comparing one expression to a number. */
type NumberFieldDialect = StringFieldDialect;

const STRING_FIELDS: Readonly<Record<string, StringFieldDialect>> = {
  origin: {
    expression: TRACE_ORIGIN_CLICKHOUSE_EXPRESSION,
    param: "origin",
    facetKey: "origin",
  },
  service: {
    expression: "Attributes['service.name']",
    param: "service",
    facetKey: "service",
  },
  traceName: {
    expression: "TraceName",
    param: "traceName",
    facetKey: "traceName",
  },
  traceId: { expression: "TraceId", param: "traceId" },
  user: {
    expression: "Attributes['langwatch.user_id']",
    param: "userId",
    facetKey: "user",
  },
  conversation: {
    expression: "Attributes['gen_ai.conversation.id']",
    param: "conversationId",
    facetKey: "conversation",
  },
  customer: {
    expression: "Attributes['langwatch.customer_id']",
    param: "customerId",
    facetKey: "customer",
  },
  scenarioRun: {
    expression: "Attributes['scenario.run_id']",
    param: "scenarioRunId",
    facetKey: "scenarioRun",
  },
  topic: { expression: "TopicId", param: "topicId", facetKey: "topic" },
  subtopic: {
    expression: "SubTopicId",
    param: "subtopicId",
    facetKey: "subtopic",
  },
  selectedPrompt: {
    expression: "SelectedPromptId",
    param: "selectedPromptId",
    facetKey: "selectedPrompt",
  },
  lastUsedPrompt: {
    expression: "LastUsedPromptId",
    param: "lastUsedPromptId",
    facetKey: "lastUsedPrompt",
  },
  tokensEstimated: {
    expression: "if(TokensEstimated, 'estimated', 'actual')",
    param: "tokensEstimated",
    facetKey: "tokensEstimated",
  },
};

const NUMBER_FIELDS: Readonly<Record<string, NumberFieldDialect>> = {
  cost: { expression: "TotalCost", param: "cost", facetKey: "cost" },
  duration: {
    expression: "TotalDurationMs",
    param: "duration",
    facetKey: "duration",
  },
  tokens: {
    expression: "TotalPromptTokenCount + TotalCompletionTokenCount",
    param: "tokens",
    facetKey: "tokens",
  },
  promptTokens: {
    expression: "TotalPromptTokenCount",
    param: "promptTokens",
    facetKey: "promptTokens",
  },
  completionTokens: {
    expression: "TotalCompletionTokenCount",
    param: "completionTokens",
    facetKey: "completionTokens",
  },
  ttft: {
    expression: "TimeToFirstTokenMs",
    param: "ttft",
    facetKey: "ttft",
  },
  ttlt: { expression: "TimeToLastTokenMs", param: "ttlt", facetKey: "ttlt" },
  tokensPerSecond: {
    expression: "TokensPerSecond",
    param: "tokensPerSecond",
    facetKey: "tokensPerSecond",
  },
  spans: { expression: "SpanCount", param: "spans", facetKey: "spans" },
  promptVersion: {
    expression: "LastUsedPromptVersionNumber",
    param: "promptVersion",
    facetKey: "promptVersion",
  },
};

/** The only status value the trace view can answer, and what it compiles to. */
const STATUS_ERROR_EXPRESSION = "ContainsErrorStatus = 1";

/**
 * `status:error`, and only that value.
 *
 * `ok` and `warning` are the two halves of "not an error", and telling them
 * apart needs the guardrail column, which the trace view does not carry. So a
 * shorthand answers the one value it can answer exactly and refuses the two it
 * would have to guess at.
 */
const statusHandler: FilterTagTranslator = (tag, negated) => {
  const value = extractStringValue(tag).toLowerCase();
  if (value !== "error") {
    throw new InstantEvalShorthandError(
      `A shorthand filter can only ask for status:error. Ask for "${value}" with a statement instead.`,
      ["status"],
    );
  }
  return wrap(STATUS_ERROR_EXPRESSION, negated);
};

/**
 * The caller's text as a `LIKE` pattern that matches it and nothing else.
 *
 * `%` and `_` are wildcards to `LIKE`, and a backslash is what escapes them,
 * so all three are escaped before any wildcard of the filter language's own is
 * written in. Without this `model:gpt_5*` also matches `gptA5`.
 */
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

/** `model:<value>`, with `*` wildcards, over the hoisted model list. */
const modelHandler: FilterTagTranslator = (tag, negated, ctx) => {
  const value = extractStringValue(tag);
  validateValueLength(value);
  const param = nextParam(ctx, "model");
  if (value.includes("*")) {
    ctx.params[param] = escapeLikePattern(value).replace(/\*/g, "%");
    return wrap(`arrayExists(m -> m LIKE {${param}:String}, Models)`, negated);
  }
  ctx.params[param] = value;
  return wrap(`has(Models, {${param}:String})`, negated);
};

/**
 * `label:<value>`, over the JSON-encoded label list on the attribute map.
 *
 * Each element comes back as a JSON scalar, quotes and escapes intact, so it
 * is decoded rather than unquoted: stripping the quotes would leave a label
 * holding a quote or a unicode escape spelled the JSON way, and it would then
 * never equal the plain value a caller typed.
 */
const labelHandler: FilterTagTranslator = (tag, negated, ctx) => {
  const value = extractStringValue(tag);
  validateValueLength(value);
  const param = nextParam(ctx, "label");
  ctx.params[param] = value;
  return wrap(
    `arrayExists(x -> JSONExtractString(x) = {${param}:String}, JSONExtractArrayRaw(Attributes['langwatch.labels']))`,
    negated,
  );
};

const CUSTOM_FIELDS: Readonly<Record<string, FilterTagTranslator>> = {
  status: statusHandler,
  model: modelHandler,
  label: labelHandler,
};

/**
 * Every field a shorthand filter can ask for, in the spelling a caller writes.
 *
 * Published so a refusal can list them and so the CLI and the docs can name
 * them from one source. `trace.attribute.<key>` is not in the list because it
 * is a prefix rather than a field.
 */
export const INSTANT_EVAL_SHORTHAND_FILTER_FIELDS: readonly string[] = [
  ...Object.keys(STRING_FIELDS),
  ...Object.keys(NUMBER_FIELDS),
  ...Object.keys(CUSTOM_FIELDS),
].sort();

/** The dialect's declared expressions, for the drift test against the facets. */
export const INSTANT_EVAL_SHORTHAND_FILTER_EXPRESSIONS: Readonly<
  Record<string, StringFieldDialect>
> = { ...STRING_FIELDS, ...NUMBER_FIELDS };

/** The prefix a shorthand reads an arbitrary trace attribute under. */
const ATTRIBUTE_PREFIXES = [
  TRACE_ATTRIBUTE_PREFIX,
  TRACE_ATTRIBUTE_PREFIX_LEGACY,
] as const;

/** `trace.attribute.<key>:<value>`, read off the trace's own attribute map. */
function translateAttribute({
  key,
  tag,
  negated,
  ctx,
}: {
  readonly key: string;
  readonly tag: TagToken;
  readonly negated: boolean;
  readonly ctx: TranslationContext;
}): string {
  validateAttributeKey(key);
  const value = extractStringValue(tag);
  validateValueLength(value);
  const keyParam = nextParam(ctx, "attrKey");
  const valueParam = nextParam(ctx, "attrValue");
  ctx.params[keyParam] = key;
  ctx.params[valueParam] = value;
  return wrap(
    `Attributes[{${keyParam}:String}] = {${valueParam}:String}`,
    negated,
  );
}

/**
 * A bare word, matched against what the trace captured and what it is called.
 *
 * Narrower than the explorer's own free text, which also reaches every span's
 * name through a subquery over the span table: the trace view cannot see that
 * table. The two captured columns carry a content permission, so a caller
 * whose key cannot read captured content has the statement refused by the
 * query policy, naming the column. That is the right answer: text you may not
 * read is text you may not search.
 */
function translateFreeText({
  tag,
  negated,
  ctx,
}: {
  readonly tag: TagToken;
  readonly negated: boolean;
  readonly ctx: TranslationContext;
}): string {
  const value = extractStringValue(tag);
  validateValueLength(value);
  const param = nextParam(ctx, "text");
  ctx.params[param] = `%${escapeLikePattern(value)}%`;
  const bound = `{${param}:String}`;
  const clause =
    `(CapturedInput ILIKE ${bound} OR CapturedOutput ILIKE ${bound}` +
    ` OR ifNull(TraceName, '') ILIKE ${bound})`;
  return negated ? `NOT ${clause}` : clause;
}

/** How one tag compiles against the LangWatchQL trace view. */
/** The attribute key a namespaced field names, or `undefined`. */
function attributeKeyOf(name: string): string | undefined {
  for (const prefix of ATTRIBUTE_PREFIXES) {
    if (!name.startsWith(prefix)) continue;
    const key = name.slice(prefix.length);
    if (!key) {
      throw new FilterParseError(`${prefix}<key> requires a key after the dot`);
    }
    return key;
  }
  return undefined;
}

/** A field's own entry in a dialect table, read without the prototype chain. */
function entryOf<T>(
  table: Readonly<Record<string, T>>,
  name: string,
): T | undefined {
  return Object.hasOwn(table, name) ? table[name] : undefined;
}

/** How one named field compiles, or the refusal that lists what does. */
function translateNamedField({
  name,
  tag,
  negated,
  ctx,
}: {
  readonly name: string;
  readonly tag: TagToken;
  readonly negated: boolean;
  readonly ctx: TranslationContext;
}): string {
  const custom = entryOf(CUSTOM_FIELDS, name);
  if (custom) return custom(tag, negated, ctx);

  const text = entryOf(STRING_FIELDS, name);
  if (text) {
    return translateStringField(text.expression, tag, negated, ctx, text.param);
  }

  const number = entryOf(NUMBER_FIELDS, name);
  if (number) {
    return translateNumericField(
      number.expression,
      tag,
      negated,
      ctx,
      number.param,
    );
  }

  throw new FilterFieldUnknownError(name, [
    ...INSTANT_EVAL_SHORTHAND_FILTER_FIELDS,
  ]);
}

/** How one tag compiles against the LangWatchQL trace view. */
const translateTag: FilterTagTranslator = (tag, negated, ctx) => {
  if (tag.field.type === "ImplicitField") {
    return translateFreeText({ tag, negated, ctx });
  }
  const name = tag.field.name;
  const attributeKey = attributeKeyOf(name);
  return attributeKey === undefined
    ? translateNamedField({ name, tag, negated, ctx })
    : translateAttribute({ key: attributeKey, tag, negated, ctx });
};

/** A compiled filter: one boolean expression and the values it binds. */
export interface CompiledInstantEvalFilter {
  readonly sql: string;
  readonly parameters: Readonly<Record<string, string | number | boolean>>;
}

/**
 * The filter as one LangWatchQL condition, or `null` when there is no filter.
 *
 * Every refusal comes back as one sentence a caller can act on: the field that
 * is not supported and the ones that are, or the syntax that could not be read.
 */
/** The refusal one of the filter language's own errors becomes. */
function shorthandFilterRefusal(error: unknown): never {
  if (error instanceof InstantEvalShorthandError) throw error;
  if (error instanceof FilterFieldUnknownError) {
    const field = String(error.meta.field ?? "that field");
    throw new InstantEvalShorthandError(
      `A shorthand filter cannot ask for "${field}". It can ask for ${INSTANT_EVAL_SHORTHAND_FILTER_FIELDS.join(", ")} and for trace.attribute.<key>. Everything else the trace explorer filters on lives outside the trace row, so ask it with a statement instead.`,
      ["filter"],
      "filter_field_unsupported",
    );
  }
  if (error instanceof FilterParseError) {
    throw new InstantEvalShorthandError(
      `That filter could not be read: ${error.message}`,
      ["filter"],
    );
  }
  throw error;
}

/** Whether a refusal is for a field the trace view cannot answer, and nothing else. */
export function isShorthandFilterFieldUnsupported(error: unknown): boolean {
  return (
    error instanceof InstantEvalShorthandError &&
    error.code === "filter_field_unsupported"
  );
}

/**
 * The filter as one LangWatchQL condition, or `null` when there is no filter.
 *
 * Every refusal comes back as one sentence a caller can act on: the field that
 * is not supported and the ones that are, or the syntax that could not be read.
 */
export function compileInstantEvalShorthandFilter(
  filterText: string | undefined,
): CompiledInstantEvalFilter | null {
  if (!filterText || filterText.trim() === "") return null;

  const ctx: TranslationContext = {
    paramCounter: 0,
    nodeCount: 0,
    params: {},
    // Neither is read by any handler above, and neither has anything to say
    // here: a statement is scoped by the row policy on the views rather than by
    // a bound tenant, and its time window is written by the target's template.
    // They are on the shared context because the trace-table dialect needs
    // them for its own subqueries.
    tenantId: "",
    timeRange: { from: 0, to: 0 },
  };

  try {
    const sql = translateFilterAst({
      queryText: filterText,
      ctx,
      translateTag,
    });
    if (sql === null) return null;
    return {
      sql,
      parameters: ctx.params as CompiledInstantEvalFilter["parameters"],
    };
  } catch (error) {
    shorthandFilterRefusal(error);
  }
}
