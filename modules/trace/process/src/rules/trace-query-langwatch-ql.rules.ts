/**
 * The trace filter language compiled against the LangWatchQL trace view: a
 * second dialect over the same boolean structure, answering what the trace row
 * carries and naming the rest (spans, evaluations, events) as out of reach.
 * @see modules/instant-eval/specs/instant-eval-shorthand.feature
 */

import {
  type FieldHandler,
  FilterFieldUnknownError,
  FilterParseError,
  FilterValueRefusedError,
  type LangWatchQLTraceFilter,
  type LangWatchQLTraceFilterValue,
  TRACE_ORIGIN_CLICKHOUSE_EXPRESSION,
  type TagToken,
  type TranslationContext,
} from "@langwatch/trace-contract";

import {
  numericComparisonHandler,
  stringEqualityHandler,
} from "./trace-query-translators.rules.ts";
import {
  TRACE_ATTRIBUTE_PREFIX,
  TRACE_ATTRIBUTE_PREFIX_LEGACY,
  extractStringValue,
  nextParam,
  validateAttributeKey,
  validateValueLength,
  wrap,
} from "./trace-query-values.rules.ts";
import { translateFilterAst } from "./trace-query.rules.ts";

/** One field's expression over the trace view, and the facet it has to equal. */
type LangWatchQLTraceFilterField = Readonly<{
  expression: string;
  /** The name its value binds under, for a readable statement. */
  param: string;
  /** Set where the explorer's facet expression is valid over the view too. */
  facetKey?: string;
}>;

const STRING_FIELDS: Readonly<Record<string, LangWatchQLTraceFilterField>> = {
  origin: { expression: TRACE_ORIGIN_CLICKHOUSE_EXPRESSION, param: "origin", facetKey: "origin" },
  service: { expression: "Attributes['service.name']", param: "service", facetKey: "service" },
  traceName: { expression: "TraceName", param: "traceName", facetKey: "traceName" },
  traceId: { expression: "TraceId", param: "traceId" },
  user: { expression: "Attributes['langwatch.user_id']", param: "userId", facetKey: "user" },
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
  subtopic: { expression: "SubTopicId", param: "subtopicId", facetKey: "subtopic" },
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

const NUMBER_FIELDS: Readonly<Record<string, LangWatchQLTraceFilterField>> = {
  cost: { expression: "TotalCost", param: "cost", facetKey: "cost" },
  duration: { expression: "TotalDurationMs", param: "duration", facetKey: "duration" },
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
  ttft: { expression: "TimeToFirstTokenMs", param: "ttft", facetKey: "ttft" },
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

const CUSTOM_FIELDS = ["status", "model", "label"] as const;

/** Every field the dialect answers, as a caller spells it; attribute prefixes aside. */
export const LANGWATCH_QL_TRACE_FILTER_FIELDS: readonly string[] = [
  ...Object.keys(STRING_FIELDS),
  ...Object.keys(NUMBER_FIELDS),
  ...CUSTOM_FIELDS,
].toSorted();

/** The declared expressions, for the drift test against the facet registry. */
export const LANGWATCH_QL_TRACE_FILTER_EXPRESSIONS: Readonly<
  Record<string, LangWatchQLTraceFilterField>
> = { ...STRING_FIELDS, ...NUMBER_FIELDS };

/** `%`, `_` and `\` escaped so only the caller's `*` becomes a LIKE wildcard. */
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

function isFilterValue(entry: [string, unknown]): entry is [string, LangWatchQLTraceFilterValue] {
  const [, value] = entry;
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

/** Compiles the trace filter language into one LangWatchQL trace-view condition. */

/** Scoped by the views' row policy, so no tenant or window is bound here. */
export function compile({ filter }: { filter: string }): LangWatchQLTraceFilter {
  const ctx: TranslationContext = {
    paramCounter: 0,
    nodeCount: 0,
    params: {},
    tenantId: "",
    timeRange: { from: 0, to: 0 },
  };
  try {
    const sql = translateFilterAst({
      queryText: filter,
      ctx,
      translateTag: (tag, negated, tagCtx) => translateTag(tag, negated, tagCtx),
    });
    if (sql === null) return { kind: "empty" };
    return {
      kind: "compiled",
      sql,
      parameters: Object.fromEntries(Object.entries(ctx.params).filter(isFilterValue)),
    };
  } catch (error) {
    if (error instanceof FilterFieldUnknownError) {
      return {
        kind: "unsupported",
        field: typeof error.meta.field === "string" ? error.meta.field : "",
        supportedFields: LANGWATCH_QL_TRACE_FILTER_FIELDS,
      };
    }
    if (error instanceof FilterValueRefusedError) {
      const field = typeof error.meta.field === "string" ? error.meta.field : "";
      return { kind: "refused", field, reason: error.message };
    }
    throw error;
  }
}

function translateTag(tag: TagToken, negated: boolean, ctx: TranslationContext): string {
  if (tag.field.type === "ImplicitField") return freeText(tag, negated, ctx);
  const name = tag.field.name;
  for (const prefix of [TRACE_ATTRIBUTE_PREFIX, TRACE_ATTRIBUTE_PREFIX_LEGACY]) {
    if (!name.startsWith(prefix)) continue;
    const key = name.slice(prefix.length);
    if (!key) throw new FilterParseError(`${prefix}<key> requires a key after the dot`);
    return attribute({ key, tag, negated, ctx });
  }
  return handlerFor(name)(tag, negated, ctx);
}

function handlerFor(name: string): FieldHandler {
  if (name === "status") return (tag, negated) => status(tag, negated);
  if (name === "model") return (tag, negated, ctx) => model(tag, negated, ctx);
  if (name === "label") return (tag, negated, ctx) => label(tag, negated, ctx);
  if (Object.hasOwn(STRING_FIELDS, name)) {
    const field = STRING_FIELDS[name];
    if (field) return stringEqualityHandler(field.expression, field.param);
  }
  if (Object.hasOwn(NUMBER_FIELDS, name)) {
    const field = NUMBER_FIELDS[name];
    if (field) return numericComparisonHandler(field.expression, field.param);
  }
  throw new FilterFieldUnknownError(name, [...LANGWATCH_QL_TRACE_FILTER_FIELDS]);
}

/** `status:error` only: telling ok from warning needs a column the view lacks. */
function status(tag: TagToken, negated: boolean): string {
  const value = extractStringValue(tag).toLowerCase();
  if (value !== "error") {
    throw new FilterValueRefusedError({
      field: "status",
      reason: `A shorthand filter can only ask for status:error. Ask for "${value}" with a statement instead.`,
    });
  }
  return wrap("ContainsErrorStatus = 1", negated);
}

/** `model:<value>`, `*` wildcards allowed, over the hoisted model list. */
function model(tag: TagToken, negated: boolean, ctx: TranslationContext): string {
  const value = extractStringValue(tag);
  validateValueLength(value);
  const param = nextParam(ctx, "model");
  if (value.includes("*")) {
    ctx.params[param] = escapeLikePattern(value).replace(/\*/g, "%");
    return wrap(`arrayExists(m -> m LIKE {${param}:String}, Models)`, negated);
  }
  ctx.params[param] = value;
  return wrap(`has(Models, {${param}:String})`, negated);
}

/** `label:<value>`: each JSON element decoded, so an escaped label still equals the value. */
function label(tag: TagToken, negated: boolean, ctx: TranslationContext): string {
  const value = extractStringValue(tag);
  validateValueLength(value);
  const param = nextParam(ctx, "label");
  ctx.params[param] = value;
  return wrap(
    `arrayExists(x -> JSONExtractString(x) = {${param}:String}, JSONExtractArrayRaw(Attributes['langwatch.labels']))`,
    negated,
  );
}

function attribute({
  key,
  tag,
  negated,
  ctx,
}: {
  key: string;
  tag: TagToken;
  negated: boolean;
  ctx: TranslationContext;
}): string {
  validateAttributeKey(key);
  const value = extractStringValue(tag);
  validateValueLength(value);
  const keyParam = nextParam(ctx, "attrKey");
  const valueParam = nextParam(ctx, "attrValue");
  ctx.params[keyParam] = key;
  ctx.params[valueParam] = value;
  return wrap(`Attributes[{${keyParam}:String}] = {${valueParam}:String}`, negated);
}

/**
 * A bare word, against what the trace captured and what it is called. The
 * captured columns carry a content permission, so a key that cannot read
 * captured content has the statement refused by the query policy.
 */
function freeText(tag: TagToken, negated: boolean, ctx: TranslationContext): string {
  const value = extractStringValue(tag);
  validateValueLength(value);
  const param = nextParam(ctx, "text");
  ctx.params[param] = `%${escapeLikePattern(value)}%`;
  const bound = `{${param}:String}`;
  const clause = `(CapturedInput ILIKE ${bound} OR CapturedOutput ILIKE ${bound} OR ifNull(TraceName, '') ILIKE ${bound})`;
  return negated ? `NOT ${clause}` : clause;
}
