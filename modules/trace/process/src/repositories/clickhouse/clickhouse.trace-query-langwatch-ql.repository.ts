/**
 * The trace filter language compiled against the LangWatchQL trace view: a
 * second dialect over the same boolean structure, answering what the trace row
 * carries and naming the rest (spans, evaluations, events) as out of reach.
 * @see specs/instant-evals/instant-eval-shorthand.feature
 */

import {
  type FieldHandler,
  FilterFieldUnknownError,
  FilterParseError,
  type LangWatchQLTraceFilter,
  type LangWatchQLTraceFilterValue,
  TRACE_ORIGIN_CLICKHOUSE_EXPRESSION,
  type TagToken,
  type TranslationContext,
} from "@langwatch/trace-contract";

import { ClickHouseTraceQueryTranslatorsRepository } from "./clickhouse.trace-query-translators.repository.ts";
import {
  ClickHouseTraceQueryValuesRepository,
  TRACE_ATTRIBUTE_PREFIX,
  TRACE_ATTRIBUTE_PREFIX_LEGACY,
} from "./clickhouse.trace-query-values.repository.ts";
import { ClickHouseTraceQueryRepository } from "./clickhouse.trace-query.repository.ts";

/** One field's expression over the trace view, and the facet it has to equal. */
export type LangWatchQLTraceFilterField = Readonly<{
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

/** A value the view cannot answer exactly: refused, never guessed at. */
class LangWatchQLFilterRefusal extends Error {
  constructor(
    readonly field: string,
    readonly reason: string,
  ) {
    super(reason);
  }
}

/** `%`, `_` and `\` escaped so only the caller's `*` becomes a LIKE wildcard. */
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

function isFilterValue(entry: [string, unknown]): entry is [string, LangWatchQLTraceFilterValue] {
  const [, value] = entry;
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

/** Compiles the trace filter language into one LangWatchQL trace-view condition. */
export class ClickHouseTraceQueryLangWatchQLRepository {
  private constructor(
    private readonly query: ClickHouseTraceQueryRepository,
    private readonly translators: ClickHouseTraceQueryTranslatorsRepository,
    private readonly values: ClickHouseTraceQueryValuesRepository,
  ) {}

  static create(): ClickHouseTraceQueryLangWatchQLRepository {
    return new ClickHouseTraceQueryLangWatchQLRepository(
      ClickHouseTraceQueryRepository.create(),
      ClickHouseTraceQueryTranslatorsRepository.create(),
      ClickHouseTraceQueryValuesRepository.create(),
    );
  }

  /** Scoped by the views' row policy, so no tenant or window is bound here. */
  compile({ filter }: { filter: string }): LangWatchQLTraceFilter {
    const ctx: TranslationContext = {
      paramCounter: 0,
      nodeCount: 0,
      params: {},
      tenantId: "",
      timeRange: { from: 0, to: 0 },
    };
    try {
      const sql = this.query.translateFilterAst({
        queryText: filter,
        ctx,
        translateTag: (tag, negated, tagCtx) => this.#translateTag(tag, negated, tagCtx),
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
      if (error instanceof LangWatchQLFilterRefusal) {
        return { kind: "refused", field: error.field, reason: error.reason };
      }
      throw error;
    }
  }

  #translateTag(tag: TagToken, negated: boolean, ctx: TranslationContext): string {
    if (tag.field.type === "ImplicitField") return this.#freeText(tag, negated, ctx);
    const name = tag.field.name;
    for (const prefix of [TRACE_ATTRIBUTE_PREFIX, TRACE_ATTRIBUTE_PREFIX_LEGACY]) {
      if (!name.startsWith(prefix)) continue;
      const key = name.slice(prefix.length);
      if (!key) throw new FilterParseError(`${prefix}<key> requires a key after the dot`);
      return this.#attribute({ key, tag, negated, ctx });
    }
    return this.#handlerFor(name)(tag, negated, ctx);
  }

  #handlerFor(name: string): FieldHandler {
    if (name === "status") return (tag, negated) => this.#status(tag, negated);
    if (name === "model") return (tag, negated, ctx) => this.#model(tag, negated, ctx);
    if (name === "label") return (tag, negated, ctx) => this.#label(tag, negated, ctx);
    if (Object.hasOwn(STRING_FIELDS, name)) {
      const field = STRING_FIELDS[name];
      if (field) return this.translators.stringEqualityHandler(field.expression, field.param);
    }
    if (Object.hasOwn(NUMBER_FIELDS, name)) {
      const field = NUMBER_FIELDS[name];
      if (field) return this.translators.numericComparisonHandler(field.expression, field.param);
    }
    throw new FilterFieldUnknownError(name, [...LANGWATCH_QL_TRACE_FILTER_FIELDS]);
  }

  /** `status:error` only: telling ok from warning needs a column the view lacks. */
  #status(tag: TagToken, negated: boolean): string {
    const value = this.values.extractStringValue(tag).toLowerCase();
    if (value !== "error") {
      throw new LangWatchQLFilterRefusal(
        "status",
        `A shorthand filter can only ask for status:error. Ask for "${value}" with a statement instead.`,
      );
    }
    return this.values.wrap("ContainsErrorStatus = 1", negated);
  }

  /** `model:<value>`, `*` wildcards allowed, over the hoisted model list. */
  #model(tag: TagToken, negated: boolean, ctx: TranslationContext): string {
    const value = this.values.extractStringValue(tag);
    this.values.validateValueLength(value);
    const param = this.values.nextParam(ctx, "model");
    if (value.includes("*")) {
      ctx.params[param] = escapeLikePattern(value).replace(/\*/g, "%");
      return this.values.wrap(`arrayExists(m -> m LIKE {${param}:String}, Models)`, negated);
    }
    ctx.params[param] = value;
    return this.values.wrap(`has(Models, {${param}:String})`, negated);
  }

  /** `label:<value>`: each JSON element decoded, so an escaped label still equals the value. */
  #label(tag: TagToken, negated: boolean, ctx: TranslationContext): string {
    const value = this.values.extractStringValue(tag);
    this.values.validateValueLength(value);
    const param = this.values.nextParam(ctx, "label");
    ctx.params[param] = value;
    return this.values.wrap(
      `arrayExists(x -> JSONExtractString(x) = {${param}:String}, JSONExtractArrayRaw(Attributes['langwatch.labels']))`,
      negated,
    );
  }

  #attribute({
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
    this.values.validateAttributeKey(key);
    const value = this.values.extractStringValue(tag);
    this.values.validateValueLength(value);
    const keyParam = this.values.nextParam(ctx, "attrKey");
    const valueParam = this.values.nextParam(ctx, "attrValue");
    ctx.params[keyParam] = key;
    ctx.params[valueParam] = value;
    return this.values.wrap(`Attributes[{${keyParam}:String}] = {${valueParam}:String}`, negated);
  }

  /**
   * A bare word, against what the trace captured and what it is called. The
   * captured columns carry a content permission, so a key that cannot read
   * captured content has the statement refused by the query policy.
   */
  #freeText(tag: TagToken, negated: boolean, ctx: TranslationContext): string {
    const value = this.values.extractStringValue(tag);
    this.values.validateValueLength(value);
    const param = this.values.nextParam(ctx, "text");
    ctx.params[param] = `%${escapeLikePattern(value)}%`;
    const bound = `{${param}:String}`;
    const clause = `(CapturedInput ILIKE ${bound} OR CapturedOutput ILIKE ${bound} OR ifNull(TraceName, '') ILIKE ${bound})`;
    return negated ? `NOT ${clause}` : clause;
  }
}
