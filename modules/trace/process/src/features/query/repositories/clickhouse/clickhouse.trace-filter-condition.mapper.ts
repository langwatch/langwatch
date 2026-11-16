/**
 * The trace filter as builder conditions over `trace_summaries` (ADR-202 Decided 18): each kind
 * keeps main's rows, and a side-table subquery reads under the filtered read's own scope.
 * Parameters are minted on the context as the text compiler mints them, so limits match.
 */
import {
  type ClickHouseRead,
  type ClickHouseReadStart,
  type Condition,
  column,
  cond,
  type Expression,
  fn,
  param,
  type ReaderScope,
  type ReadOps,
  tenantScope,
} from "@langwatch/clickhouse-client/builder";
import {
  FilterFieldUnknownError,
  FilterParseError,
  FilterValueRefusedError,
  INSTANT_EVAL_TARGET_FIELDS,
  type ResolvedInstantEvalRun,
  type TagToken,
  type TranslationContext,
} from "@langwatch/trace-contract";

import { evaluationRuns } from "../../../../repositories/clickhouse/clickhouse.evaluation-runs.table.ts";
import { instantEvalJudgments } from "../../../../repositories/clickhouse/clickhouse.instant-eval-judgments.table.ts";
import { simulationRuns } from "../../../../repositories/clickhouse/clickhouse.simulation-runs.table.ts";
import { storedSpans } from "../../../../repositories/clickhouse/clickhouse.stored-spans.table.ts";
import { traceSummaries } from "../../../../repositories/clickhouse/clickhouse.trace-summaries.table.ts";
import {
  EVALUATION_RUN_EXPRESSIONS,
  STORED_SPAN_EXPRESSIONS,
  TRACE_SUMMARY_CATEGORICAL_EXPRESSIONS,
  TRACE_SUMMARY_RANGE_EXPRESSIONS,
} from "../../../facet/repositories/clickhouse/clickhouse.trace-facet-expressions.mapper.ts";
import {
  type EvaluationScope,
  keptGroups,
  scopedFacet,
} from "../../rules/trace-query-evaluation-scope.rules.ts";
import type { KnownField } from "../../rules/trace-query-fields.rules.ts";
import { findRuns } from "../../rules/trace-query-instant-eval-fields.rules.ts";
import {
  FEEDBACK_TRACKED_EVENT_TYPE,
  HAS_VALUES,
  SCENARIO_STATUS_BY_LABEL,
  SCENARIO_VERDICT_BY_LABEL,
  traceAttributeKeyOf,
} from "../../rules/trace-query-meta-fields.rules.ts";
import {
  extractNumericValue,
  extractStringValue,
  nextParam,
  TRACE_ATTRIBUTE_PREFIX,
  TRACE_ATTRIBUTE_PREFIX_LEGACY,
  validateAttributeKey,
  validateValueLength,
} from "../../rules/trace-query-values.rules.ts";
import {
  attributeTargetOf,
  type FilterLogic,
  walkFilterAst,
} from "../../rules/trace-query.rules.ts";
import type { TraceQueryFieldsService } from "../../services/trace-query-fields.service.ts";

const ts = traceSummaries;
const spans = storedSpans;
const runs = evaluationRuns;
const scenarios = simulationRuns;
const judgments = instantEvalJudgments;

type SummaryCondition = Condition<"trace_summaries">;

/** One compiled term: a condition of the read it filters, which lends its scope to subqueries. */
export type TraceFilterCondition = <S extends ReaderScope, C extends Record<string, unknown>>(
  ops: ReadOps<S, "trace_summaries", C>,
) => SummaryCondition;

/** A query compiled: nothing for an empty one, else the filter. */
export type TraceFilterCompilation =
  | { kind: "empty" }
  | ({ kind: "compiled" } & CompiledTraceFilter);

/** A trace filter compiled for a built read over `trace_summaries`. */
export interface CompiledTraceFilter {
  where: TraceFilterCondition;
  /** A term reads `stored_spans`, which the explorer's `dateField: "updated"` asks of a filter. */
  readsSpans: boolean;
}

/** A read's trace filter, compiled for the scope that read runs under (ADR-202 Decided 25). */
export type TraceFilterCompile = (input: { scope: ReaderScope }) => TraceFilterCompilation;

/** `compilation` with `terms` ANDed on; empty when neither carries a term. */
export function andTraceFilterTerms({
  compilation,
  terms,
}: {
  compilation: TraceFilterCompilation;
  terms: readonly TraceFilterCondition[];
}): TraceFilterCompilation {
  const all = compilation.kind === "compiled" ? [compilation.where, ...terms] : [...terms];
  const [first, ...rest] = all;
  if (first === undefined) return { kind: "empty" };
  return {
    kind: "compiled",
    where: rest.length === 0 ? first : (ops) => ops.and(...all.map((term) => term(ops))),
    readsSpans: compilation.kind === "compiled" && compilation.readsSpans,
  };
}

interface Compilation {
  ctx: TranslationContext;
  /** A proof-fenced read: every side subquery reads its shared windows (Decided 27). */
  windowed: boolean;
  searchContent: boolean;
  isHiddenAttribute: (key: string) => boolean;
  fields: TraceQueryFieldsService;
  readsSpans: boolean;
}

type ConditionHandler = (tag: TagToken, negated: boolean, c: Compilation) => TraceFilterCondition;

const constant =
  (condition: SummaryCondition): TraceFilterCondition =>
  () =>
    condition;

/**
 * `NOT term`. A side-table term negates as `NOT IN`: `NOT (… IN (SELECT …))` would negate the
 * subquery's tenant predicate, which the reader refuses.
 */
function negatedTerm(term: TraceFilterCondition): TraceFilterCondition {
  return (ops) => {
    let membership: Condition | undefined;
    const within: typeof ops.within = (left, build, options) => {
      membership = ops.within(left, build, { negated: options?.negated !== true });
      return membership;
    };
    const condition = term({ ...ops, within });
    return membership !== undefined && condition === membership ? condition : ops.not(condition);
  };
}

const polarised = (term: TraceFilterCondition, negated: boolean): TraceFilterCondition =>
  negated ? negatedTerm(term) : term;

const nothing = (negated: boolean) => constant(negated ? cond.always() : cond.never());

const CONDITION_LOGIC: FilterLogic<TraceFilterCondition> = {
  always: () => constant(cond.always()),
  and: (left, right) => (ops) => ops.and(left(ops), right(ops)),
  or: (left, right) => (ops) => ops.or(left(ops), right(ops)),
  group: (inner) => inner,
};

/** One parameter minted under `name`, as the text compiler mints it, so the tally matches. */
function mint(c: Pick<Compilation, "ctx">, name: string, value: unknown): void {
  c.ctx.params[nextParam(c.ctx, name)] = value;
}

/** The tag's value, checked as the text compiler checks it. */
function stringOf(tag: TagToken): string {
  const value = extractStringValue(tag);
  validateValueLength(value);
  return value;
}

function bindString({
  tag,
  c,
  name,
}: {
  tag: TagToken;
  c: Pick<Compilation, "ctx">;
  name: string;
}): string {
  const value = stringOf(tag);
  mint(c, name, value);
  return value;
}

/** Terms joined as main joins a scoped group: alternatives with OR, a range with AND. */
function joined<T extends string>(terms: readonly Condition<T>[], anyOf: boolean): Condition<T> {
  const [first, ...rest] = terms;
  if (first === undefined) return cond.always();
  return anyOf ? cond.or(first, ...rest) : cond.and(first, ...rest);
}

/** A value with `*` is a LIKE, its `*` as `%`, bound as the text compiler binds it. */
function matchOf(
  value: string,
): { kind: "like"; bound: string } | { kind: "exact"; bound: string } {
  return value.includes("*")
    ? { kind: "like", bound: value.replace(/\*/g, "%") }
    : { kind: "exact", bound: value };
}

function stringCondition<T extends string>({
  expression,
  tag,
  c,
  name,
}: {
  expression: Expression<string | null, T>;
  tag: TagToken;
  c: Pick<Compilation, "ctx">;
  name: string;
}): Condition<T> {
  return cond.eq(expression, bindString({ tag, c, name }));
}

/** `expression <op> value` or the inclusive `[min TO max]`, bound as Float64 as main binds it. */
function numericCondition<T extends string>({
  expression,
  tag,
  c,
  name,
}: {
  expression: Expression<number | null, T>;
  tag: TagToken;
  c: Pick<Compilation, "ctx">;
  name: string;
}): Condition<T> {
  if (tag.expression.type === "RangeExpression") {
    const { min, max } = tag.expression.range;
    mint(c, `${name}Min`, min);
    mint(c, `${name}Max`, max);
    return cond.and(
      cond.gte(expression, param.float64(min)),
      cond.lte(expression, param.float64(max)),
    );
  }
  const operator = tag.operator.operator;
  const value = extractNumericValue(tag);
  mint(c, name, value);
  const bound = param.float64(value);
  switch (operator) {
    case ":":
      return cond.eq(expression, bound);
    case ":>":
      return cond.gt(expression, bound);
    case ":<":
      return cond.lt(expression, bound);
    case ":>=":
      return cond.gte(expression, bound);
    case ":<=":
      return cond.lte(expression, bound);
    default:
      throw new FilterParseError(`Unsupported operator: ${operator}`);
  }
}

/** `left IN (SELECT …)` under the filtered read's scope. */
function withinSide<
  S extends ReaderScope,
  C extends Record<string, unknown>,
  SubTables extends string,
  SubRow extends Record<string, unknown>,
>(
  ops: ReadOps<S, "trace_summaries", C>,
  left: Expression<unknown, "trace_summaries">,
  build: (sub: ClickHouseReadStart<S, C>) => ClickHouseRead<S, SubTables, SubRow, C>,
): Condition {
  return ops.within(left, build);
}

/** Under a share a side read keeps to its windows on the table's own time column (Decided 27). */
function keptToShare<R extends { withinWindows(): R }>(c: Compilation, read: R): R {
  return c.windowed ? read.withinWindows() : read;
}

/** Traces with a span in the window passing `inner`; main's `boundedSubquery` on `stored_spans`. */
function spansWith(c: Compilation, inner: Condition<"stored_spans">): TraceFilterCondition {
  c.readsSpans = true;
  const { from, to } = c.ctx.timeRange;
  return (ops) =>
    withinSide(ops, fn.tuple(ts.TenantId, ts.TraceId), (sub) => {
      const read = sub
        .from(spans)
        .distinct()
        .select({ TenantId: spans.TenantId, TraceId: spans.TraceId })
        .where(({ and, gte, lte }) =>
          and(gte(spans.StartTime, from), lte(spans.StartTime, to), inner),
        );
      return keptToShare(c, read);
    });
}

/** Traces with an evaluation scheduled in the window passing `inner`, every stored version read. */
function evaluationRunsWith(
  c: Compilation,
  inner: Condition<"evaluation_runs">,
): TraceFilterCondition {
  const { from, to } = c.ctx.timeRange;
  return (ops) =>
    withinSide(ops, fn.tuple(ts.TenantId, ts.TraceId), (sub) =>
      keptToShare(
        c,
        sub
          .from(runs)
          .distinct()
          .select({ TenantId: runs.TenantId, TraceId: runs.TraceId })
          .where(({ and, gte, lte }) =>
            and(gte(runs.ScheduledAt, from), lte(runs.ScheduledAt, to), inner),
          ),
      ),
    );
}

/** Traces with one of evaluator `evaluatorId`'s latest evaluations passing every `inner`. */
function latestEvaluationRunsWith({
  c,
  evaluatorId,
  inner,
}: {
  c: Compilation;
  evaluatorId: string;
  inner: readonly Condition<"evaluation_runs">[];
}): TraceFilterCondition {
  const { from, to } = c.ctx.timeRange;
  return (ops) =>
    withinSide(ops, fn.tuple(ts.TenantId, ts.TraceId), (sub) => {
      const ofEvaluator = sub
        .from(runs)
        .distinct()
        .select({ TenantId: runs.TenantId, TraceId: runs.TraceId })
        .where(({ and, eq, gte, lte }) =>
          and(
            gte(runs.ScheduledAt, from),
            lte(runs.ScheduledAt, to),
            eq(runs.EvaluatorId, evaluatorId),
          ),
        );
      const passing =
        inner.length === 0
          ? ofEvaluator
          : ofEvaluator.where(() => joined(inner, false), { inElection: false });
      return keptToShare(c, passing).latestVersion();
    });
}

/**
 * Traces whose `scenario.run_id` names a scenario run whose latest version passes `inner`. The
 * election is over the table's key (TenantId, ScenarioRunId); main grouped by set and batch too.
 */
function scenarioRunsWith(
  c: Compilation,
  inner: Condition<"simulation_runs">,
): TraceFilterCondition {
  const { from, to } = c.ctx.timeRange;
  return (ops) =>
    withinSide(ops, fn.tuple(ts.TenantId, fn.mapGet(ts.Attributes, "scenario.run_id")), (sub) =>
      keptToShare(
        c,
        sub
          .from(scenarios)
          .select({ TenantId: scenarios.TenantId, ScenarioRunId: scenarios.ScenarioRunId })
          .where(({ and, gte, lte }) =>
            and(gte(scenarios.StartedAt, from), lte(scenarios.StartedAt, to)),
          )
          .where(() => inner, { inElection: false }),
      ).latestVersion(),
    );
}

/** The rows an Instant Eval run judged as passed, by trace or by conversation (main's subquery). */
function judgedBy(c: Compilation, run: ResolvedInstantEvalRun): TraceFilterCondition {
  mint(c, "evalRun", run.runId);
  mint(c, "evalWrittenFrom", run.writtenFrom);
  mint(c, "evalWrittenUntil", run.writtenUntil);
  const judged = cond.and(
    cond.eq(judgments.RunId, run.runId),
    cond.gte(judgments.CreatedAt, run.writtenFrom),
    cond.lte(judgments.CreatedAt, run.writtenUntil),
  );
  const passed = cond.eq(fn.argMax(judgments.Passed, judgments.UpdatedAt), 1);
  const keys = [
    judgments.TenantId,
    judgments.TraceId,
    judgments.SpanId,
    judgments.QuestionId,
  ] as const;
  if (run.target === "threads") {
    // A threads run addresses a conversation by its last trace, so the conversation is matched.
    const thread = fn.argMax(judgments.ThreadId, judgments.UpdatedAt);
    return (ops) =>
      withinSide(
        ops,
        fn.tuple(ts.TenantId, fn.mapGet(ts.Attributes, "gen_ai.conversation.id")),
        (sub) =>
          keptToShare(
            c,
            sub
              .from(judgments)
              .select({ TenantId: judgments.TenantId, MatchedThreadId: thread })
              .where(() => judged)
              .groupBy(...keys)
              .having(() => cond.and(passed, cond.ne(thread, ""))),
          ),
      );
  }
  return (ops) =>
    withinSide(ops, fn.tuple(ts.TenantId, ts.TraceId), (sub) =>
      keptToShare(
        c,
        sub
          .from(judgments)
          .select({ TenantId: judgments.TenantId, TraceId: judgments.TraceId })
          .where(() => judged)
          .groupBy(...keys)
          .having(() => passed),
      ),
    );
}

const summary =
  (build: (tag: TagToken, c: Compilation) => SummaryCondition): ConditionHandler =>
  (tag, negated, c) =>
    polarised(constant(build(tag, c)), negated);

const categoricalField = (key: keyof typeof TRACE_SUMMARY_CATEGORICAL_EXPRESSIONS) =>
  summary((tag, c) =>
    stringCondition({ expression: TRACE_SUMMARY_CATEGORICAL_EXPRESSIONS[key], tag, c, name: key }),
  );

const rangeField = (key: keyof typeof TRACE_SUMMARY_RANGE_EXPRESSIONS) =>
  summary((tag, c) =>
    numericCondition({ expression: TRACE_SUMMARY_RANGE_EXPRESSIONS[key], tag, c, name: key }),
  );

const evaluationField =
  (key: "evaluatorStatus" | "evaluatorVerdict" | "evaluatorLabel"): ConditionHandler =>
  (tag, negated, c) =>
    polarised(
      evaluationRunsWith(
        c,
        stringCondition({ expression: EVALUATION_RUN_EXPRESSIONS[key], tag, c, name: key }),
      ),
      negated,
    );

const spanField =
  (key: keyof typeof STORED_SPAN_EXPRESSIONS): ConditionHandler =>
  (tag, negated, c) =>
    polarised(
      spansWith(
        c,
        stringCondition({ expression: STORED_SPAN_EXPRESSIONS[key], tag, c, name: key }),
      ),
      negated,
    );

const scenarioColumn =
  (name: "ScenarioId" | "ScenarioSetId" | "BatchRunId"): ConditionHandler =>
  (tag, negated, c) =>
    polarised(scenarioRunsWith(c, cond.eq(scenarios[name], bindString({ tag, c, name }))), negated);

function scenarioLabel({
  column: name,
  labels,
  describe,
}: {
  column: "Status" | "Verdict";
  labels: Record<string, string>;
  describe: (raw: string) => string;
}): ConditionHandler {
  return (tag, negated, c) => {
    const raw = extractStringValue(tag);
    validateValueLength(raw);
    const mapped = labels[raw.toLowerCase()];
    if (!mapped) throw new FilterParseError(describe(raw));
    mint(c, `scenario${name}`, mapped);
    return polarised(scenarioRunsWith(c, cond.eq(scenarios[name], mapped)), negated);
  };
}

const evaluatorNamed: ConditionHandler = (tag, negated, c) =>
  polarised(
    evaluationRunsWith(
      c,
      cond.eq(runs.EvaluatorName, bindString({ tag, c, name: "evaluatorName" })),
    ),
    negated,
  );

const instantEvalField =
  (fieldName: "eval" | "eval.trace" | "eval.conversation" | "eval.llm"): ConditionHandler =>
  (tag, negated, c) => {
    const question = stringOf(tag);
    const forced = INSTANT_EVAL_TARGET_FIELDS[fieldName];
    const [run] = findRuns({ ctx: c.ctx, question, target: forced });
    if (run) return polarised(judgedBy(c, run), negated);
    // A forcing spelling can only mean an Instant Eval, so with no run it matches nothing.
    if (forced) return nothing(negated);
    return evaluatorNamed(tag, negated, c);
  };

/** `has:` / `none:` each probe, or main's error for a value it does not know. */
function existence(tag: TagToken, negated: boolean, c: Compilation): TraceFilterCondition {
  const value = stringOf(tag);
  const attribute = traceAttributeKeyOf(value);
  if (attribute.kind === "attribute") {
    if (!attribute.key) throw new FilterParseError("attribute.<key> requires a key after the dot");
    mint(c, "attrKey", attribute.key);
    return polarised(constant(cond.ne(fn.mapGet(ts.Attributes, attribute.key), "")), negated);
  }
  const present = (expression: Expression<string | null, "trace_summaries">) =>
    cond.ne(fn.ifNull(expression, ""), "");
  const labels = fn.mapGet(ts.Attributes, "langwatch.labels");
  const probes: Readonly<Record<string, () => TraceFilterCondition>> = {
    error: () => constant(cond.eq(ts.ContainsErrorStatus, true)),
    eval: () => evaluationRunsWith(c, cond.always()),
    feedback: () => spansWith(c, fn.has(spans["Events.Name"], FEEDBACK_TRACKED_EVENT_TYPE)),
    annotation: () => constant(cond.gt(fn.length(ts.AnnotationIds), 0)),
    conversation: () => constant(cond.ne(fn.mapGet(ts.Attributes, "gen_ai.conversation.id"), "")),
    user: () => constant(cond.ne(fn.mapGet(ts.Attributes, "langwatch.user_id"), "")),
    customer: () => constant(cond.ne(fn.mapGet(ts.Attributes, "langwatch.customer_id"), "")),
    topic: () => constant(present(ts.TopicId)),
    subtopic: () => constant(present(ts.SubTopicId)),
    label: () => constant(cond.and(cond.ne(labels, ""), cond.ne(labels, "[]"))),
    model: () => constant(cond.gt(fn.length(ts.Models), 0)),
    service: () => constant(cond.ne(fn.mapGet(ts.Attributes, "service.name"), "")),
    traceName: () => constant(present(ts.TraceName)),
    rootSpanType: () => constant(present(ts.RootSpanType)),
  };
  const probe = Object.hasOwn(probes, value) ? probes[value] : undefined;
  if (!probe) {
    throw new FilterParseError(
      `Unknown has/none value "${value}". Valid: ${HAS_VALUES.join(", ")}, attribute.<key>`,
    );
  }
  return polarised(probe(), negated);
}

const traceIdField = summary((tag, c) => {
  const value = stringOf(tag);
  const match = matchOf(value);
  mint(c, "traceId", match.bound);
  return match.kind === "exact" ? cond.eq(ts.TraceId, value) : fn.like(ts.TraceId, match.bound);
});

/** Every filter field's condition; `satisfies` keeps it level with the text compiler's fields. */
const FIELD_CONDITIONS = {
  status: categoricalField("status"),
  origin: categoricalField("origin"),
  service: categoricalField("service"),
  model: summary((tag, c) => {
    const value = stringOf(tag);
    const match = matchOf(value);
    mint(c, "model", match.bound);
    if (match.kind === "exact") return fn.has(ts.Models, value);
    return fn.arrayExists((model) => fn.like(model, match.bound), ts.Models);
  }),
  user: categoricalField("user"),
  conversation: categoricalField("conversation"),
  customer: categoricalField("customer"),
  scenarioRun: summary((tag, c) =>
    cond.eq(
      fn.mapGet(ts.Attributes, "scenario.run_id"),
      bindString({ tag, c, name: "scenarioRunId" }),
    ),
  ),
  topic: categoricalField("topic"),
  subtopic: categoricalField("subtopic"),
  traceName: categoricalField("traceName"),
  rootSpanType: categoricalField("rootSpanType"),
  guardrail: categoricalField("guardrail"),
  annotation: categoricalField("annotation"),
  containsAi: categoricalField("containsAi"),
  errorMessage: categoricalField("errorMessage"),
  tokensEstimated: categoricalField("tokensEstimated"),
  selectedPrompt: categoricalField("selectedPrompt"),
  lastUsedPrompt: categoricalField("lastUsedPrompt"),
  promptVersion: rangeField("promptVersion"),
  label: summary((tag, c) => {
    const value = bindString({ tag, c, name: "label" });
    return fn.arrayExists(
      (raw) => cond.eq(fn.trimBoth(raw, '"'), value),
      fn.JSONExtractArrayRaw(fn.mapGet(ts.Attributes, "langwatch.labels")),
    );
  }),
  cost: rangeField("cost"),
  duration: rangeField("duration"),
  tokens: rangeField("tokens"),
  ttft: rangeField("ttft"),
  ttlt: rangeField("ttlt"),
  promptTokens: rangeField("promptTokens"),
  completionTokens: rangeField("completionTokens"),
  tokensPerSecond: rangeField("tokensPerSecond"),
  spans: rangeField("spans"),
  size: rangeField("size"),
  evaluator: (tag, negated, c) =>
    polarised(
      evaluationRunsWith(c, cond.eq(runs.EvaluatorId, bindString({ tag, c, name: "evaluatorId" }))),
      negated,
    ),
  evaluatorStatus: evaluationField("evaluatorStatus"),
  evaluatorVerdict: evaluationField("evaluatorVerdict"),
  evaluatorScore: (tag, negated, c) =>
    polarised(
      evaluationRunsWith(
        c,
        numericCondition({
          expression: EVALUATION_RUN_EXPRESSIONS.evaluatorScore,
          tag,
          c,
          name: "evaluatorScore",
        }),
      ),
      negated,
    ),
  evaluatorLabel: evaluationField("evaluatorLabel"),
  spanType: spanField("spanType"),
  spanName: spanField("spanName"),
  spanStatus: spanField("spanStatus"),
  has: existence,
  none: (tag, negated, c) => existence(tag, !negated, c),
  eval: instantEvalField("eval"),
  "eval.trace": instantEvalField("eval.trace"),
  "eval.conversation": instantEvalField("eval.conversation"),
  "eval.llm": instantEvalField("eval.llm"),
  event: (tag, negated, c) =>
    polarised(
      spansWith(c, fn.has(spans["Events.Name"], bindString({ tag, c, name: "eventName" }))),
      negated,
    ),
  trace: traceIdField,
  traceId: traceIdField,
  prompt: summary((tag, c) =>
    fn.has(
      fn.JSONExtract(
        fn.mapGet(ts.Attributes, "langwatch.prompt_ids"),
        column.array(column.string()),
      ),
      bindString({ tag, c, name: "promptId" }),
    ),
  ),
  spanId: (tag, negated, c) => {
    const value = stringOf(tag);
    const match = matchOf(value);
    mint(c, "spanId", match.bound);
    const inner =
      match.kind === "exact" ? cond.eq(spans.SpanId, value) : fn.like(spans.SpanId, match.bound);
    return polarised(spansWith(c, inner), negated);
  },
  scenario: scenarioColumn("ScenarioId"),
  scenarioSet: scenarioColumn("ScenarioSetId"),
  scenarioBatch: scenarioColumn("BatchRunId"),
  scenarioVerdict: scenarioLabel({
    column: "Verdict",
    labels: SCENARIO_VERDICT_BY_LABEL,
    describe: (raw) => `Unknown scenario verdict "${raw}". Valid: success, failure, inconclusive`,
  }),
  scenarioStatus: scenarioLabel({
    column: "Status",
    labels: SCENARIO_STATUS_BY_LABEL,
    describe: (raw) =>
      `Unknown scenario status "${raw}". Valid: ${Object.keys(SCENARIO_STATUS_BY_LABEL).join(", ")}`,
  }),
  evaluatorPassed: evaluationField("evaluatorVerdict"),
} satisfies Record<KnownField, ConditionHandler>;

const FIELD_CONDITION_BY_NAME: ReadonlyMap<string, ConditionHandler> = new Map(
  Object.entries(FIELD_CONDITIONS),
);

/** A namespaced attribute: on the summary, on a span, or on a span's event. */
function attributeCondition({
  target,
  key,
  tag,
  negated,
  c,
}: {
  target: "trace" | "span" | "event";
  key: string;
  tag: TagToken;
  negated: boolean;
  c: Compilation;
}): TraceFilterCondition {
  if (!key) throw new FilterParseError(`${target}.attribute.<key> requires a key after the dot`);
  validateAttributeKey(key);
  const value = stringOf(tag);
  const prefix = target === "trace" ? "attr" : `${target}Attr`;
  mint(c, `${prefix}Key`, key);
  mint(c, `${prefix}Value`, value);
  if (target === "trace") {
    return polarised(constant(cond.eq(fn.mapGet(ts.Attributes, key), value)), negated);
  }
  const inner =
    target === "span"
      ? cond.eq(fn.mapGet(spans.SpanAttributes, key), value)
      : fn.arrayExists(
          (attributes) => cond.eq(fn.mapGet(attributes, key), value),
          spans["Events.Attributes"],
        );
  return polarised(spansWith(c, inner), negated);
}

/** A bare word: captured I/O when the viewer may read it, the trace name, and every span name. */
function freeText(tag: TagToken, negated: boolean, c: Compilation): TraceFilterCondition {
  const pattern = `%${stringOf(tag)}%`;
  mint(c, "freeText", pattern);
  const name = fn.ilike(fn.ifNull(ts.TraceName, ""), pattern);
  const own = c.searchContent
    ? cond.or(fn.ilike(ts.ComputedInput, pattern), fn.ilike(ts.ComputedOutput, pattern), name)
    : name;
  const named = spansWith(c, fn.ilike(spans.SpanName, pattern));
  return negated
    ? (ops) => ops.and(ops.not(own), negatedTerm(named)(ops))
    : (ops) => ops.or(own, named(ops));
}

function translateTag(tag: TagToken, negated: boolean, c: Compilation): TraceFilterCondition {
  if (tag.field.type === "ImplicitField") return freeText(tag, negated, c);
  const fieldName = tag.field.name;
  const attribute = attributeTargetOf(fieldName);
  if (attribute.kind === "attribute") {
    // A value the viewer may not read is never matched; negated, nothing is excluded by it.
    if (c.isHiddenAttribute(attribute.key)) return nothing(negated);
    return attributeCondition({ target: attribute.target, key: attribute.key, tag, negated, c });
  }
  const handler = FIELD_CONDITION_BY_NAME.get(fieldName);
  if (!handler) throw new FilterFieldUnknownError(fieldName, [...c.fields.knownFields]);
  return handler(tag, negated, c);
}

/** An evaluator and its bound result conditions, held on that evaluator's own latest runs. */
function evaluationScope(scope: EvaluationScope, c: Compilation): TraceFilterCondition {
  const evaluatorId = bindString({ tag: scope.anchor, c, name: "evaluatorId" });
  const resultOf = (condition: EvaluationScope["conditions"][number]) => {
    const { key } = scopedFacet({ field: condition.field, fields: c.fields });
    if (key === "evaluatorScore") {
      return numericCondition({
        expression: EVALUATION_RUN_EXPRESSIONS.evaluatorScore,
        tag: condition.tag,
        c,
        name: key,
      });
    }
    if (!isEvaluationFacet(key)) throw new Error(`facet '${key}' binds no evaluation result`);
    return stringCondition({
      expression: EVALUATION_RUN_EXPRESSIONS[key],
      tag: condition.tag,
      c,
      name: key,
    });
  };
  const kept = keptGroups({ scope, fields: c.fields }).map(({ conditions, anyOf }) => {
    return joined(conditions.map(resultOf), anyOf);
  });
  const excluded = scope.conditions.filter((condition) => condition.negated).map(resultOf);
  const runsOf = (inner: readonly Condition<"evaluation_runs">[]) =>
    latestEvaluationRunsWith({ c, evaluatorId, inner });
  const keptRuns = runsOf(kept);
  const excludedRuns = excluded.map((condition) => runsOf([condition]));
  return (ops) => ops.and(keptRuns(ops), ...excludedRuns.map((term) => negatedTerm(term)(ops)));
}

function isEvaluationFacet(
  key: string,
): key is "evaluatorStatus" | "evaluatorVerdict" | "evaluatorLabel" {
  return key === "evaluatorStatus" || key === "evaluatorVerdict" || key === "evaluatorLabel";
}

/**
 * A liqe query as conditions for a built `trace_summaries` read.
 * Compiled inside each read, for that read's scope; the rest mirrors `translateFilter`.
 */
export function compileTraceFilterCondition({
  queryText,
  timeRange,
  evalRuns,
  ...options
}: {
  queryText: string;
  timeRange: { from: number; to: number };
  evalRuns?: readonly ResolvedInstantEvalRun[];
  searchContent?: boolean;
  isHiddenAttribute?: (key: string) => boolean;
  /** The read's scope: under a proof, span subqueries read its shared windows. */
  scope: ReaderScope;
  fields: TraceQueryFieldsService;
}): TraceFilterCompilation {
  return translateFilterConditions({
    queryText,
    ctx: contextFor({ timeRange, ...(evalRuns ? { evalRuns } : {}) }),
    ...options,
  });
}

function contextFor({
  timeRange,
  evalRuns,
}: {
  timeRange: { from: number; to: number };
  evalRuns?: readonly ResolvedInstantEvalRun[];
}): TranslationContext {
  return {
    paramCounter: 0,
    nodeCount: 0,
    params: { timeFrom: timeRange.from, timeTo: timeRange.to },
    timeRange,
    ...(evalRuns ? { evalRuns } : {}),
  };
}

/** The walk over a caller's context, whose `params` then hold what the text compiler binds. */
export function translateFilterConditions({
  scope,
  ...options
}: {
  queryText: string;
  ctx: TranslationContext;
  searchContent?: boolean;
  isHiddenAttribute?: (key: string) => boolean;
  scope: ReaderScope;
  fields: TraceQueryFieldsService;
}): TraceFilterCompilation {
  return walkConditions({ ...options, windowed: scope.kind === "proof" });
}

function walkConditions({
  queryText,
  ctx,
  windowed,
  searchContent = true,
  isHiddenAttribute = () => false,
  fields,
}: {
  queryText: string;
  ctx: TranslationContext;
  windowed: boolean;
  searchContent?: boolean;
  isHiddenAttribute?: (key: string) => boolean;
  fields: TraceQueryFieldsService;
}): TraceFilterCompilation {
  const c: Compilation = {
    ctx,
    windowed,
    searchContent,
    isHiddenAttribute,
    fields,
    readsSpans: false,
  };
  const where = walkFilterAst({
    queryText,
    ctx,
    translateTag: (tag, negated) => translateTag(tag, negated, c),
    translateScope: (evaluation) => evaluationScope(evaluation, c),
    logic: CONDITION_LOGIC,
  });
  if (where.kind === "empty") return where;
  return { kind: "compiled", where: where.compiled, readsSpans: c.readsSpans };
}

/**
 * The filter checked as the reads compile it, refusing what they refuse (FilterParseError and
 * kin) without running a read. No condition is applied, so no tenant is consulted.
 */
export function checkTraceFilter({
  queryText,
  timeRange = { from: 0, to: 0 },
  evalRuns,
  ...options
}: {
  queryText: string;
  timeRange?: { from: number; to: number };
  evalRuns?: readonly ResolvedInstantEvalRun[];
  searchContent?: boolean;
  isHiddenAttribute?: (key: string) => boolean;
  fields: TraceQueryFieldsService;
}): TraceFilterCompilation["kind"] {
  return walkConditions({
    queryText,
    ctx: contextFor({ timeRange, ...(evalRuns ? { evalRuns } : {}) }),
    windowed: false,
    ...options,
  }).kind;
}

/** A query compiled inside each read for that read's scope (Decided 25), `terms` ANDed on. */
export function traceFilterCompileOf({
  terms = [],
  ...options
}: {
  queryText: string;
  timeRange: { from: number; to: number };
  evalRuns?: readonly ResolvedInstantEvalRun[];
  searchContent?: boolean;
  isHiddenAttribute?: (key: string) => boolean;
  fields: TraceQueryFieldsService;
  terms?: readonly TraceFilterCondition[];
}): TraceFilterCompile {
  return ({ scope }) =>
    andTraceFilterTerms({ compilation: compileTraceFilterCondition({ ...options, scope }), terms });
}

/** The traces of one conversation, as the conversation-context read selects them. */
export function conversationTraceFilter({
  conversationId,
}: {
  conversationId: string;
}): TraceFilterCompile {
  const where = constant(
    cond.eq(TRACE_SUMMARY_CATEGORICAL_EXPRESSIONS.conversation, conversationId),
  );
  return () => ({ kind: "compiled", where, readsSpans: false });
}

/** The Explorer's hidden origins left out; an unstamped trace reads as "application" and stays. */
export function findHiddenOriginFilters({
  hiddenOrigins,
}: {
  hiddenOrigins: readonly string[];
}): TraceFilterCondition[] {
  if (hiddenOrigins.length === 0) return [];
  return [
    constant(
      cond.not(cond.oneOf(TRACE_SUMMARY_CATEGORICAL_EXPRESSIONS.origin, [...hiddenOrigins])),
    ),
  ];
}

/** LangWatchQL's string fields by their facet key (trace-query-langwatch-ql.rules.ts). */
const LANGWATCH_QL_STRINGS = {
  origin: "origin",
  service: "service",
  traceName: "traceName",
  user: "user",
  conversation: "conversation",
  customer: "customer",
  topic: "topic",
  subtopic: "subtopic",
  selectedPrompt: "selectedPrompt",
  lastUsedPrompt: "lastUsedPrompt",
  tokensEstimated: "tokensEstimated",
} as const satisfies Record<string, keyof typeof TRACE_SUMMARY_CATEGORICAL_EXPRESSIONS>;

const LANGWATCH_QL_NUMBERS = {
  cost: "cost",
  duration: "duration",
  tokens: "tokens",
  promptTokens: "promptTokens",
  completionTokens: "completionTokens",
  ttft: "ttft",
  ttlt: "ttlt",
  tokensPerSecond: "tokensPerSecond",
  spans: "spans",
  promptVersion: "promptVersion",
} as const satisfies Record<string, keyof typeof TRACE_SUMMARY_RANGE_EXPRESSIONS>;

const LANGWATCH_QL_ATTRIBUTE_PREFIXES = [TRACE_ATTRIBUTE_PREFIX, TRACE_ATTRIBUTE_PREFIX_LEGACY];

/** One LangWatchQL term on the summary row, as trace-query-langwatch-ql.rules.ts compiles it. */
function langWatchQLTerm(tag: TagToken, c: Pick<Compilation, "ctx">): SummaryCondition {
  if (tag.field.type === "ImplicitField") {
    throw new FilterValueRefusedError({
      field: "text",
      reason: "Free text cannot narrow a trace summary read; name a field instead.",
    });
  }
  const name = tag.field.name;
  const prefix = LANGWATCH_QL_ATTRIBUTE_PREFIXES.find((each) => name.startsWith(each));
  if (prefix !== undefined) {
    const key = name.slice(prefix.length);
    if (!key) throw new FilterParseError(`${prefix}<key> requires a key after the dot`);
    validateAttributeKey(key);
    mint(c, "attrKey", key);
    return cond.eq(fn.mapGet(ts.Attributes, key), bindString({ tag, c, name: "attrValue" }));
  }
  if (name === "traceId") return stringCondition({ expression: ts.TraceId, tag, c, name });
  if (name === "scenarioRun") {
    const expression = fn.mapGet(ts.Attributes, "scenario.run_id");
    return stringCondition({ expression, tag, c, name: "scenarioRunId" });
  }
  if (name === "status") {
    const value = extractStringValue(tag).toLowerCase();
    if (value !== "error") {
      throw new FilterValueRefusedError({
        field: "status",
        reason: `A shorthand filter can only ask for status:error. Ask for "${value}" with a statement instead.`,
      });
    }
    return cond.eq(ts.ContainsErrorStatus, true);
  }
  if (name === "model") {
    const value = bindString({ tag, c, name: "model" });
    if (!value.includes("*")) return fn.has(ts.Models, value);
    const pattern = value.replace(/[\\%_]/g, "\\$&").replace(/\*/g, "%");
    return fn.arrayExists((model) => fn.like(model, pattern), ts.Models);
  }
  if (name === "label") {
    const value = bindString({ tag, c, name: "label" });
    return fn.arrayExists(
      (raw) => cond.eq(fn.JSONExtractString(raw), value),
      fn.JSONExtractArrayRaw(fn.mapGet(ts.Attributes, "langwatch.labels")),
    );
  }
  if (Object.hasOwn(LANGWATCH_QL_STRINGS, name)) {
    const key = LANGWATCH_QL_STRINGS[name as keyof typeof LANGWATCH_QL_STRINGS];
    return stringCondition({
      expression: TRACE_SUMMARY_CATEGORICAL_EXPRESSIONS[key],
      tag,
      c,
      name,
    });
  }
  if (Object.hasOwn(LANGWATCH_QL_NUMBERS, name)) {
    const key = LANGWATCH_QL_NUMBERS[name as keyof typeof LANGWATCH_QL_NUMBERS];
    return numericCondition({ expression: TRACE_SUMMARY_RANGE_EXPRESSIONS[key], tag, c, name });
  }
  throw new FilterFieldUnknownError(name, [
    ...Object.keys(LANGWATCH_QL_STRINGS),
    ...Object.keys(LANGWATCH_QL_NUMBERS),
    "status",
    "model",
    "label",
    "traceId",
    "scenarioRun",
  ]);
}

/**
 * A LangWatchQL trace filter as conditions on `trace_summaries`, for the summary list read: the
 * dialect's fields, none reading a side table, so the read's scope is not consulted.
 */
export function compileLangWatchQLTraceCondition({
  filter,
}: {
  filter: string;
}): TraceFilterCompilation {
  const ctx: TranslationContext = {
    paramCounter: 0,
    nodeCount: 0,
    params: {},
    timeRange: { from: 0, to: 0 },
  };
  const c = { ctx };
  const where = walkFilterAst({
    queryText: filter,
    ctx,
    translateTag: (tag, negated) => polarised(constant(langWatchQLTerm(tag, c)), negated),
    logic: CONDITION_LOGIC,
  });
  if (where.kind === "empty") return where;
  return { kind: "compiled", where: where.compiled, readsSpans: false };
}

/** A filter compiled once outside any read, at the tenant's own scope, so it is refused early. */
export function precompiledTraceFilter({
  compile,
  tenantId,
}: {
  compile: TraceFilterCompile;
  tenantId: string;
}): TraceFilterCompilation {
  return compile({ scope: tenantScope.single({ tenantId }) });
}
