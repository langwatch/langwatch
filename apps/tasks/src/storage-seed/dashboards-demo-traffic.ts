/**
 * The dashboards demo's traffic, pure: one project's conversations on one day, each turn a
 * collector body (spans, metadata, evaluations) plus its end-user thumbs events. Shapes
 * follow the prototype spec; ids derive from project, date and index, so a re-run repeats.
 */
import type {
  CollectorRESTParams,
  RESTEvaluation,
  Span,
  TrackEventRESTParamsValidator,
} from "@langwatch/trace-contract";

import { type DemoDay, isWeekend } from "./dashboards-demo-days.ts";
import type { DashboardsDemoAgent } from "./dashboards-demo-ids.ts";
import { DemoRandom, hexId } from "./dashboards-demo-random.ts";
import type {
  DashboardsDemoChange,
  DashboardsDemoEffect,
  DashboardsDemoEvaluator,
  DashboardsDemoGenerativeAction,
  DashboardsDemoOutcome,
  DashboardsDemoProjectSpec,
} from "./dashboards-demo-spec.ts";
import { DEMO_CUSTOMERS } from "./dashboards-demo-story.ts";

/** USD per million input and output tokens, the providers' list prices. */
export const MODEL_PRICES: Record<string, [number, number]> = {
  "gpt-5-nano": [0.05, 0.4],
  "gpt-5-mini": [0.25, 2],
  "gpt-5": [1.25, 10],
  "claude-haiku-4-5": [1, 5],
  "claude-sonnet-4-5": [3, 15],
  "gemini-2.5-pro": [1.25, 10],
};

/** The sub-agents a planner hands work to, each its own named agent span. */
const PLANNER_SUB_AGENTS = ["cart-agent", "payment-agent"] as const;

const OUTCOMES: DashboardsDemoOutcome[] = [
  "resolved",
  "misunderstood",
  "capability_gap",
  "refusal",
  "handover",
];

const DEFAULT_ERROR_TYPES: [string, number][] = [
  ["timeout", 0.4],
  ["tool_error", 0.3],
  ["rate_limit", 0.2],
  ["upstream_5xx", 0.1],
];

/**
 * Judges and checks that read safety, not answer quality, so a failed conversation does not
 * drag them.
 */
const SAFETY_CHECKS = new Set([
  "pii-guard",
  "pii-leak",
  "prompt-injection",
  "inappropriate",
  "schema-valid",
  "no-repeat",
  "tenant-policy",
]);

export interface DemoTurn {
  body: CollectorRESTParams;
  events: TrackEventRESTParamsValidator[];
}

const clamp = ({ value, min = 0, max = 1 }: { value: number; min?: number; max?: number }) =>
  Math.max(min, Math.min(max, value));

/** How strongly a change applies on a prototype day and UTC hour: 0 before it, ramping to 1. */
function effectWeight({
  change,
  day,
  hour,
}: {
  change: DashboardsDemoChange;
  day: number;
  hour: number;
}): number {
  const effect = change.effect;
  if (!effect || day < change.day) return 0;
  if (effect.untilDay !== undefined && day >= effect.untilDay) return 0;
  if (effect.hours && (hour < effect.hours[0] || hour >= effect.hours[1])) return 0;
  const ramp = effect.rampDays ?? 0;
  return ramp > 0 ? Math.min(1, (day - change.day + 1) / ramp) : 1;
}

interface ActiveEffect {
  effect: DashboardsDemoEffect;
  weight: number;
  change: DashboardsDemoChange;
}

function activeEffects({
  spec,
  day,
  hour,
}: {
  spec: DashboardsDemoProjectSpec;
  day: number;
  hour: number;
}): ActiveEffect[] {
  return spec.changes.flatMap((change) => {
    const weight = effectWeight({ change, day, hour });
    return weight > 0 && change.effect ? [{ effect: change.effect, weight, change }] : [];
  });
}

function shiftOf({
  effects,
  get,
}: {
  effects: ActiveEffect[];
  get: (effect: DashboardsDemoEffect) => number | undefined;
}): number {
  return effects.reduce((sum, { effect, weight }) => sum + (get(effect) ?? 0) * weight, 0);
}

function multOf({
  effects,
  get,
}: {
  effects: ActiveEffect[];
  get: (effect: DashboardsDemoEffect) => number | undefined;
}): number {
  return effects.reduce((product, { effect, weight }) => {
    const value = get(effect);
    return value === undefined ? product : product * (1 + (value - 1) * weight);
  }, 1);
}

/** The prompt or config version a trace ran on: the latest release on or before its day. */
function versionOn({ spec, day }: { spec: DashboardsDemoProjectSpec; day: number }): string {
  const releases = spec.changes.filter(
    (change) => change.day <= day && (change.kind === "prompt" || change.kind === "base-prompt"),
  );
  const latest = releases[releases.length - 1];
  return latest ? (latest.version ?? latest.label) : `${spec.id} baseline`;
}

/**
 * Traces per day: the prototype's volume scaled to a dev box, times the size flag, growing
 * about 0.4% a day. Interactive agents are lighter at weekends; a batch job is not.
 */
export function demoTracesPerDay({
  spec,
  agent,
  day,
  scale,
}: {
  spec: DashboardsDemoProjectSpec;
  agent: DashboardsDemoAgent;
  day: DemoDay;
  scale: number;
}): number {
  const base = clamp({ value: Math.round(spec.traffic.reqPerDay / 30), min: 12, max: 90 });
  const weekend = agent.shape !== "batch" && isWeekend(day) ? 0.6 : 1;
  const growth = 1 - day.daysAgo * 0.004;
  return Math.max(1, Math.round(base * weekend * growth * scale));
}

function turnsOf({ spec, random }: { spec: DashboardsDemoProjectSpec; random: DemoRandom }) {
  if (spec.archetype === "extraction" || spec.archetype === "generative") return 1;
  if (spec.archetype === "voice") {
    const mean = spec.turnsPerCall ?? 6;
    return random.int({ min: Math.max(2, mean - 3), max: mean + 3 });
  }
  return random.weighted<number>([
    [1, 0.35],
    [2, 0.3],
    [3, 0.2],
    [4, 0.15],
  ]);
}

function averageTurns(spec: DashboardsDemoProjectSpec): number {
  if (spec.archetype === "extraction" || spec.archetype === "generative") return 1;
  if (spec.archetype === "voice") return spec.turnsPerCall ?? 6;
  return 2.15;
}

function topicsOn({
  spec,
  day,
}: {
  spec: DashboardsDemoProjectSpec;
  day: number;
}): [string, number][] {
  const topics = spec.vocab.topics ?? [["general", 1]];
  const rising = (spec.vocab.newTopics ?? []).flatMap(([topic, weight, firstDay]) =>
    day >= firstDay
      ? [[topic, weight * Math.min(1, (day - firstDay + 1) / 7)] as [string, number]]
      : [],
  );
  return [...topics, ...rising];
}

function outcomeMix({
  spec,
  effects,
  segment,
  topic,
  customer,
}: {
  spec: DashboardsDemoProjectSpec;
  effects: ActiveEffect[];
  segment: string;
  topic: string;
  customer: string | undefined;
}): [DashboardsDemoOutcome, number][] {
  const mix = OUTCOMES.map((outcome) => {
    const shifted =
      spec.outcomes[outcome] + shiftOf({ effects, get: (effect) => effect.outcome?.[outcome] });
    return [outcome, Math.max(0, shifted)] as [DashboardsDemoOutcome, number];
  });
  const segmentShift =
    (spec.segmentShift?.[segment] ?? 0) +
    shiftOf({
      effects,
      get: (effect) =>
        (effect.segments?.[segment] ?? 0) +
        (effect.tenants?.[segment] ?? 0) +
        (effect.topics?.[topic] ?? 0) +
        (customer ? (effect.customers?.[customer] ?? 0) : 0),
    });
  if (segmentShift === 0) return mix;
  const resolved = mix[0]?.[1] ?? 0;
  const nextResolved = clamp({ value: resolved + segmentShift, min: 0.05, max: 0.98 });
  const failures = 1 - resolved;
  const scale = failures > 0 ? (1 - nextResolved) / failures : 0;
  return mix.map(([outcome, share]) => [
    outcome,
    outcome === "resolved" ? nextResolved : share * scale,
  ]);
}

function failureReason({
  spec,
  effects,
  outcome,
  random,
}: {
  spec: DashboardsDemoProjectSpec;
  effects: ActiveEffect[];
  outcome: DashboardsDemoOutcome;
  random: DemoRandom;
}): string | undefined {
  const reasons = spec.failureReasons
    .filter(([, explains]) => explains === outcome)
    .map(
      ([reason, , weight]) =>
        [
          reason,
          weight * multOf({ effects, get: (effect) => effect.failureReasons?.[reason] }),
        ] as [string, number],
    );
  return reasons.length > 0 ? random.weighted(reasons) : undefined;
}

function previewFor({
  spec,
  outcome,
  reason,
  topic,
  language,
  random,
}: {
  spec: DashboardsDemoProjectSpec;
  outcome: DashboardsDemoOutcome;
  reason: string | undefined;
  topic: string;
  language: string | undefined;
  random: DemoRandom;
}): [string, string] {
  const vocab = spec.vocab;
  const byLanguage = language ? vocab.previewsByLang?.[language] : undefined;
  if (byLanguage && byLanguage.length > 0) return random.pick(byLanguage);
  if (outcome !== "resolved") {
    const narrow = reason ? vocab.previewsByReason?.[`${topic}|${reason}`] : undefined;
    const byReason = reason ? vocab.previewsByReason?.[reason] : undefined;
    const cannot = outcome === "capability_gap" ? vocab.cannotDo?.[topic] : undefined;
    const pool = narrow ?? cannot ?? byReason;
    if (pool && pool.length > 0) return random.pick(pool);
  }
  const byTopic = vocab.previewsByTopic?.[topic];
  return random.pick(byTopic && byTopic.length > 0 ? byTopic : vocab.previews);
}

function modelMix({
  spec,
  effects,
  random,
}: {
  spec: DashboardsDemoProjectSpec;
  effects: ActiveEffect[];
  random: DemoRandom;
}): [string, number][] {
  const switched = [...effects].reverse().find(({ effect }) => effect.models);
  if (switched?.effect.models && random.chance(switched.weight)) return switched.effect.models;
  return spec.traffic.models;
}

function costOf({
  model,
  promptTokens,
  completionTokens,
  multiplier,
}: {
  model: string;
  promptTokens: number;
  completionTokens: number;
  multiplier: number;
}): number {
  const [input, output] = MODEL_PRICES[model] ?? [1, 4];
  return ((promptTokens * input + completionTokens * output) / 1_000_000) * multiplier;
}

function errorCapture(message: string): NonNullable<Span["error"]> {
  return { has_error: true, message, stacktrace: [] };
}

interface SpanClock {
  at: number;
}

/** Omit per member of the Span union, so each span type keeps its own fields. */
type SpanFields<S = Span> = S extends unknown
  ? Omit<S, "span_id" | "parent_id" | "trace_id" | "timestamps">
  : never;

function childSpan({
  traceId,
  parentId,
  spanId,
  clock,
  durationMs,
  fields,
}: {
  traceId: string;
  parentId: string;
  spanId: string;
  clock: SpanClock;
  durationMs: number;
  fields: SpanFields;
}): Span {
  const startedAt = clock.at;
  clock.at += Math.max(5, Math.round(durationMs));
  return {
    ...fields,
    span_id: spanId,
    parent_id: parentId,
    trace_id: traceId,
    timestamps: { started_at: startedAt, finished_at: clock.at },
  } as Span;
}

interface Turn {
  agent: DashboardsDemoAgent;
  traceId: string;
  startedAt: number;
  isLastTurn: boolean;
  threadId: string | undefined;
  userId: string | undefined;
  customerId: string | undefined;
  segment: string;
  topic: string;
  language: string | undefined;
  outcome: DashboardsDemoOutcome;
  reason: string | undefined;
  generativeAction: DashboardsDemoGenerativeAction | undefined;
}

function generativeAction({
  spec,
  effects,
  segment,
  random,
}: {
  spec: DashboardsDemoProjectSpec;
  effects: ActiveEffect[];
  segment: string;
  random: DemoRandom;
}): DashboardsDemoGenerativeAction | undefined {
  if (!spec.generative) return undefined;
  const lean =
    (spec.segmentShift?.[segment] ?? 0) +
    shiftOf({ effects, get: (effect) => effect.segments?.[segment] });
  const actions = (["accepted", "edited", "regenerated", "dropped"] as const).map(
    (action) =>
      [
        action,
        Math.max(
          0.001,
          (spec.generative?.[action] ?? 0) +
            shiftOf({ effects, get: (effect) => effect.generative?.[action] }) +
            (action === "accepted" ? lean : action === "dropped" ? -lean / 2 : 0),
        ),
      ] as [DashboardsDemoGenerativeAction, number],
  );
  return random.weighted(actions);
}

function evaluationsFor({
  spec,
  effects,
  turn,
  finishedAt,
  random,
}: {
  spec: DashboardsDemoProjectSpec;
  effects: ActiveEffect[];
  turn: Turn;
  finishedAt: number;
  random: DemoRandom;
}): RESTEvaluation[] {
  const timestamps = { started_at: finishedAt + 400, finished_at: finishedAt + 2_400 };
  const evaluations: RESTEvaluation[] = [];
  for (const evaluator of spec.evaluators) {
    if (!random.chance(evaluator.sampleRate)) continue;
    const isOutcomeJudge = evaluator.id === "outcome-judge";
    if (isOutcomeJudge && !turn.isLastTurn) continue;
    evaluations.push(
      isOutcomeJudge
        ? outcomeJudgement({ evaluator, turn, timestamps })
        : verdict({ spec, effects, evaluator, turn, timestamps, random }),
    );
  }
  for (const guardrail of spec.guardrails) {
    if (!random.chance(guardrail.coverage)) continue;
    const blocked = random.chance(guardrail.blockRate);
    const flagged = !blocked && random.chance(guardrail.flagRate);
    evaluations.push({
      evaluation_id: `eval_${turn.traceId}_${guardrail.id}`,
      evaluator_id: `guardrail-${guardrail.id}`,
      name: guardrail.name,
      type: "guardrail",
      is_guardrail: true,
      status: "processed",
      passed: !blocked,
      label: blocked ? "blocked" : flagged ? "flagged" : "allowed",
      timestamps,
    });
  }
  return evaluations;
}

/** The conversation outcome judge: a category judge over the whole thread, on its last turn. */
function outcomeJudgement({
  evaluator,
  turn,
  timestamps,
}: {
  evaluator: DashboardsDemoEvaluator;
  turn: Turn;
  timestamps: { started_at: number; finished_at: number };
}): RESTEvaluation {
  return {
    evaluation_id: `eval_${turn.traceId}_${evaluator.id}`,
    evaluator_id: evaluator.id,
    name: evaluator.name,
    type: "langevals/llm_category",
    evaluation_thread_id: turn.threadId ?? null,
    status: "processed",
    passed: turn.outcome === "resolved",
    label: turn.outcome,
    details: turn.reason ?? "The conversation reached its goal.",
    timestamps,
  };
}

function verdict({
  spec,
  effects,
  evaluator,
  turn,
  timestamps,
  random,
}: {
  spec: DashboardsDemoProjectSpec;
  effects: ActiveEffect[];
  evaluator: DashboardsDemoEvaluator;
  turn: Turn;
  timestamps: { started_at: number; finished_at: number };
  random: DemoRandom;
}): RESTEvaluation {
  const base = clamp({
    value: evaluator.passRate + shiftOf({ effects, get: (effect) => effect.evals?.[evaluator.id] }),
  });
  const leansOnOutcome = !SAFETY_CHECKS.has(evaluator.id);
  const resolvedShare = spec.outcomes.resolved;
  const probability = !leansOnOutcome
    ? base
    : turn.outcome === "resolved"
      ? clamp({ value: base + (1 - base) * 0.6 })
      : clamp({ value: base - (base * 0.7 * resolvedShare) / Math.max(0.05, 1 - resolvedShare) });
  const passed = random.chance(probability);
  const score = passed ? 0.7 + random.next() * 0.3 : 0.1 + random.next() * 0.45;
  return {
    evaluation_id: `eval_${turn.traceId}_${evaluator.id}`,
    evaluator_id: evaluator.id,
    name: evaluator.name,
    type: "langevals/llm_boolean",
    status: "processed",
    passed,
    score: Math.round(score * 1000) / 1000,
    details: passed ? undefined : (turn.reason ?? "Did not meet the rubric."),
    timestamps,
  };
}

/** Extraction: which fields came out right, from the base accuracies and the day's effects. */
function fieldResults({
  spec,
  effects,
  segment,
  random,
}: {
  spec: DashboardsDemoProjectSpec;
  effects: ActiveEffect[];
  segment: string;
  random: DemoRandom;
}): { field: string; correct: boolean }[] {
  return (spec.fields ?? []).map(([field, accuracy]) => {
    const shift = shiftOf({
      effects,
      get: (effect) =>
        (effect.fields?.[field] ?? 0) +
        (effect.fields?.[`${segment}:${field}`] ?? 0) +
        (effect.fields?.[`${segment}:*`] ?? 0),
    });
    return { field, correct: random.chance(clamp({ value: accuracy + shift })) };
  });
}

function spansFor({
  spec,
  effects,
  turn,
  input,
  output,
  random,
}: {
  spec: DashboardsDemoProjectSpec;
  effects: ActiveEffect[];
  turn: Turn;
  input: string;
  output: string;
  random: DemoRandom;
}): { spans: Span[]; finishedAt: number; failed: boolean } {
  const traceId = turn.traceId;
  const rootId = hexId({ key: `${traceId}:root`, length: 16 });
  const clock: SpanClock = { at: turn.startedAt + random.int({ min: 2, max: 20 }) };
  const children: Span[] = [];
  const latencyScale = multOf({ effects, get: (effect) => effect.p95 });
  const p95 = (spec.traffic.p95Ms ?? 2500) * latencyScale;
  const errorRate =
    (spec.traffic.errRate ?? 0.011) * multOf({ effects, get: (effect) => effect.errors });
  const failed = random.chance(errorRate);
  const errorType = failed
    ? random.weighted(spec.vocab.errorTypes ?? DEFAULT_ERROR_TYPES)
    : undefined;
  let next = 0;
  const id = () => hexId({ key: `${traceId}:${next++}`, length: 16 });

  if (spec.vocab.retrieval) {
    const empty = errorType === "empty_retrieval";
    children.push(
      childSpan({
        traceId,
        parentId: rootId,
        spanId: id(),
        clock,
        durationMs: random.logNormal({ median: p95 * 0.08, p95: p95 * 0.2 }),
        fields: {
          type: "rag",
          name: "retrieve",
          input: { type: "text", value: input },
          contexts: empty
            ? []
            : [1, 2, 3].map((rank) => ({
                document_id: `doc-${turn.topic.replace(/\s+/g, "-")}-${rank}`,
                content: rank === 1 ? output : `Background on ${turn.topic}.`,
              })),
          error: empty ? errorCapture("No documents matched the query") : undefined,
        },
      }),
    );
  }

  const stageScale = (stage: string) => latencyOf({ effects, segment: turn.segment, stage });
  if (spec.archetype === "voice") {
    for (const stage of ["stt", "tts"] as const) {
      if (stage === "tts") children.push(llmSpan());
      const stageP95 = (spec.voiceStages?.[stage] ?? 300) * stageScale(stage);
      children.push(
        childSpan({
          traceId,
          parentId: rootId,
          spanId: id(),
          clock,
          durationMs: random.logNormal({ median: stageP95 * 0.55, p95: stageP95 }),
          fields: { type: "span", name: stage },
        }),
      );
    }
  } else {
    const tools = toolsFor({ spec, turn, random, effects });
    const planner = turn.agent.shape === "planner";
    if (planner) children.push(llmSpan({ name: "plan" }));
    for (const [position, tool] of tools.entries()) {
      const isFailing = failed && errorType === "tool_error" && position === 0;
      let parentId = rootId;
      if (planner) {
        const subAgent = PLANNER_SUB_AGENTS[position % PLANNER_SUB_AGENTS.length] ?? "worker";
        parentId = id();
        children.push(
          childSpan({
            traceId,
            parentId: rootId,
            spanId: parentId,
            clock: { at: clock.at },
            durationMs: 0,
            fields: { type: "agent", name: subAgent, params: { "gen_ai.agent.name": subAgent } },
          }),
        );
      }
      const toolSpan = childSpan({
        traceId,
        parentId,
        spanId: id(),
        clock,
        durationMs: random.logNormal({ median: p95 * 0.06, p95: p95 * 0.2 }),
        fields: {
          type: "tool",
          name: tool,
          input: { type: "json", value: { topic: turn.topic } },
          output: isFailing ? undefined : { type: "json", value: { ok: true } },
          error: isFailing ? errorCapture(`${tool} returned 500`) : undefined,
        },
      });
      children.push(toolSpan);
      // A sub-agent span closes when its tool call does.
      const subAgentSpan = planner ? children.find((span) => span.span_id === parentId) : undefined;
      if (subAgentSpan) subAgentSpan.timestamps.finished_at = toolSpan.timestamps.finished_at;
    }
    children.push(llmSpan());
  }

  function llmSpan({ name }: { name?: string } = {}): Span {
    const models = modelMix({ spec, effects, random });
    const model = random.weighted(models);
    const tokens = Math.round(
      random.logNormal({ median: spec.traffic.tokPerReq * 0.85, p95: spec.traffic.tokPerReq * 2 }),
    );
    const promptTokens = Math.round(tokens * spec.vocab.inRatio);
    const completionTokens = Math.max(8, tokens - promptTokens);
    const cost = costOf({
      model,
      promptTokens,
      completionTokens,
      multiplier: multOf({ effects, get: (effect) => effect.cost }),
    });
    const retried = random.chance(spec.retryShare);
    if (retried) {
      children.push(
        childSpan({
          traceId,
          parentId: rootId,
          spanId: id(),
          clock,
          durationMs: random.int({ min: 150, max: 900 }),
          fields: {
            type: "llm",
            name: "llm.retry",
            model,
            error: errorCapture("429 rate limit, retrying"),
          },
        }),
      );
    }
    const llmP95 =
      spec.archetype === "voice" ? (spec.voiceStages?.llm ?? 600) * stageScale("llm") : p95 * 0.6;
    const durationMs = random.logNormal({ median: llmP95 * 0.5, p95: llmP95 });
    const isFailing = failed && (errorType === "timeout" || errorType === "rate_limit");
    const span = childSpan({
      traceId,
      parentId: rootId,
      spanId: id(),
      clock,
      durationMs,
      fields: {
        type: "llm",
        name: name ?? (spec.archetype === "voice" ? "llm_turn" : "generate"),
        model,
        input: { type: "chat_messages", value: [{ role: "user", content: input }] },
        output: isFailing ? undefined : { type: "text", value: output },
        error: isFailing
          ? errorCapture(
              errorType === "timeout"
                ? "Model call timed out after 30s"
                : "429 rate limit exceeded",
            )
          : undefined,
        metrics: { prompt_tokens: promptTokens, completion_tokens: completionTokens, cost },
      },
    });
    if ((spec.coverage.ttft ?? 0) > 0 && !isFailing) {
      span.timestamps.first_token_at =
        span.timestamps.started_at + Math.round(durationMs * (0.25 + random.next() * 0.2));
    }
    return span;
  }

  const rootName = spec.vocab.namesByTopic?.[turn.topic] ?? random.pick(spec.vocab.names);
  const root = {
    span_id: rootId,
    trace_id: traceId,
    type: spec.archetype === "rag" || spec.archetype === "extraction" ? "chain" : "agent",
    name: rootName,
    params: { "gen_ai.agent.name": turn.agent.name },
    input: { type: "text", value: input },
    output: failed ? undefined : { type: "text", value: output },
    error: failed ? errorCapture(errorType ?? "error") : undefined,
    timestamps: {
      started_at: turn.startedAt,
      finished_at: clock.at + random.int({ min: 2, max: 30 }),
    },
  } as Span;
  return { spans: [root, ...children], finishedAt: root.timestamps.finished_at, failed };
}

function latencyOf({
  effects,
  segment,
  stage,
}: {
  effects: ActiveEffect[];
  segment: string;
  stage: string;
}): number {
  return multOf({
    effects,
    get: (effect) => {
      const value = effect.segmentLatency?.[segment];
      if (value === undefined) return undefined;
      return typeof value === "number" ? value : value[stage];
    },
  });
}

function toolsFor({
  spec,
  turn,
  random,
  effects,
}: {
  spec: DashboardsDemoProjectSpec;
  turn: Turn;
  random: DemoRandom;
  effects: ActiveEffect[];
}): string[] {
  const tools = spec.vocab.tools;
  if (spec.archetype === "extraction") {
    const review = turn.outcome === "handover";
    return tools.filter((tool) => !(review && tool === "post_to_erp"));
  }
  const handover = tools.find((tool) => tool.startsWith("handover"));
  const ordinary = tools.filter((tool) => tool !== handover && tool !== "llm_turn");
  const picked = [random.pick(ordinary)];
  if (ordinary.length > 1 && random.chance(0.45)) picked.push(random.pick(ordinary));
  const loops = spec.loopShare * multOf({ effects, get: (effect) => effect.loops });
  if (random.chance(loops)) {
    const looped = picked[0] ?? ordinary[0];
    if (looped) picked.push(looped, looped, looped);
  }
  if (turn.outcome === "handover" && turn.isLastTurn && handover) picked.push(handover);
  return picked;
}

/** One conversation's turns on a day: the traces and their thumbs events, all deterministic. */
export function conversationTurns({
  spec,
  agent,
  projectSlug,
  demoDay,
  index,
}: {
  spec: DashboardsDemoProjectSpec;
  agent: DashboardsDemoAgent;
  projectSlug: string;
  demoDay: DemoDay;
  /** With the project, agent and day it names every id. */
  index: number;
}): DemoTurn[] {
  const key = `${projectSlug}_${agent.name}_${demoDay.key}_${index}`;
  const random = new DemoRandom(key);
  const day = demoDay.prototypeDay;
  const hour = random.weighted<number>(
    Array.from({ length: 24 }, (_, h) => [h, hourWeight({ agent, hour: h })]),
  );
  const effects = activeEffects({ spec, day, hour });
  const segment = random.weighted(spec.attention.values);
  const topic =
    spec.attention.unit === "topic" || spec.attention.unit === "documentType"
      ? segment
      : random.weighted(topicsOn({ spec, day }));
  const language =
    spec.attention.unit === "language"
      ? segment
      : spec.languages
        ? random.weighted(spec.languages)
        : undefined;
  const interactive = agent.shape !== "batch";
  const userId =
    interactive && random.chance(spec.coverage.user_id ?? 0)
      ? `user-${String(Math.floor(Math.pow(random.next(), 2.2) * 400)).padStart(3, "0")}`
      : undefined;
  const customerId = userId ? customerOf(userId) : undefined;
  const outcome = random.weighted(
    outcomeMix({ spec, effects, segment, topic, customer: customerId }),
  );
  const reviewShift = shiftOf({ effects, get: (effect) => effect.reviewShare });
  const finalOutcome: DashboardsDemoOutcome =
    spec.archetype === "extraction" && outcome === "handover" && reviewShift < 0
      ? random.chance(-reviewShift / Math.max(0.05, spec.outcomes.handover))
        ? "resolved"
        : outcome
      : outcome;
  const reason =
    finalOutcome === "resolved"
      ? undefined
      : failureReason({ spec, effects, outcome: finalOutcome, random });
  const threadId =
    interactive && random.chance(spec.coverage.thread_id ?? 0) ? `thread_${key}` : undefined;
  const turns = turnsOf({ spec, random });
  const action = generativeAction({ spec, effects, segment, random });
  const fields =
    spec.archetype === "extraction" ? fieldResults({ spec, effects, segment, random }) : [];
  let startedAt = demoDay.dayStart + hour * 3_600_000 + random.int({ min: 0, max: 3_540_000 });
  const result: DemoTurn[] = [];

  for (let turnIndex = 0; turnIndex < turns; turnIndex++) {
    const traceId = hexId({ key: `trace:${key}_${turnIndex}`, length: 32 });
    const isLastTurn = turnIndex === turns - 1;
    const turn: Turn = {
      agent,
      traceId,
      startedAt,
      isLastTurn,
      threadId,
      userId,
      customerId,
      segment,
      topic,
      language,
      outcome: isLastTurn ? finalOutcome : "resolved",
      reason: isLastTurn ? reason : undefined,
      generativeAction: action,
    };
    const [input, output] = previewFor({
      spec,
      outcome: turn.outcome,
      reason: turn.reason,
      topic,
      language,
      random,
    });
    const { spans, finishedAt, failed } = spansFor({ spec, effects, turn, input, output, random });
    const evaluations = evaluationsFor({ spec, effects, turn, finishedAt, random });
    if (fields.length > 0) {
      const wrong = fields.filter(({ correct }) => !correct).map(({ field }) => field);
      evaluations.push({
        evaluation_id: `eval_${traceId}_fields`,
        evaluator_id: "field-accuracy-per-field",
        name: "Field accuracy per field",
        type: "custom",
        status: "processed",
        passed: wrong.length === 0,
        score: Math.round(((fields.length - wrong.length) / fields.length) * 1000) / 1000,
        details: wrong.length > 0 ? `Wrong: ${wrong.join(", ")}` : "All fields correct",
        timestamps: { started_at: finishedAt + 100, finished_at: finishedAt + 300 },
      });
    }
    result.push({
      body: {
        trace_id: traceId,
        spans,
        metadata: metadataFor({ spec, turn, random, version: versionOn({ spec, day }), fields }),
        evaluations,
      },
      events: feedbackFor({ spec, effects, turn, failed, finishedAt, random }),
    });
    startedAt = finishedAt + random.int({ min: 15_000, max: 90_000 });
  }
  return result;
}

/** Interactive agents follow the working day; a batch job runs between 01:00 and 04:00 UTC. */
function hourWeight({ agent, hour }: { agent: DashboardsDemoAgent; hour: number }): number {
  if (agent.shape === "batch") return hour >= 1 && hour < 4 ? 1 : 0;
  return hour >= 8 && hour <= 18 ? 3 : hour >= 6 && hour <= 22 ? 1 : 0.25;
}

/** The customer an end user belongs to, fixed per user so a customer's users stay theirs. */
function customerOf(userId: string): string {
  return new DemoRandom(`customer:${userId}`).weighted(DEMO_CUSTOMERS);
}

function metadataFor({
  spec,
  turn,
  random,
  version,
  fields,
}: {
  spec: DashboardsDemoProjectSpec;
  turn: Turn;
  random: DemoRandom;
  version: string;
  fields: { field: string; correct: boolean }[];
}): NonNullable<CollectorRESTParams["metadata"]> {
  const coverage = spec.coverage;
  const labels = random.chance(coverage.labels ?? 0)
    ? [turn.topic, ...(turn.generativeAction ? [turn.generativeAction] : [])]
    : undefined;
  const sendsOutcome =
    turn.isLastTurn &&
    !spec.evaluators.some((evaluator) => evaluator.id === "outcome-judge") &&
    random.chance(coverage.outcome ?? 0);
  return {
    thread_id: turn.threadId,
    user_id: turn.userId,
    customer_id: turn.customerId,
    labels,
    sdk_language: "python",
    topic: turn.topic,
    [spec.attention.unit === "documentType" ? "document_type" : spec.attention.unit]:
      spec.attention.names?.[turn.segment] ?? turn.segment,
    ...(turn.language && random.chance(coverage.language ?? 0) ? { language: turn.language } : {}),
    ...(sendsOutcome ? { outcome: turn.outcome } : {}),
    ...(sendsOutcome && turn.reason ? { outcome_reason: turn.reason } : {}),
    ...(turn.generativeAction ? { output_action: turn.generativeAction } : {}),
    ...(spec.archetype === "extraction"
      ? {
          sent_to_review: turn.outcome === "handover",
          fields_wrong: fields.filter(({ correct }) => !correct).map(({ field }) => field),
        }
      : {}),
    ...(random.chance(coverage.prompt_id ?? 0) ? { prompt_version: version } : {}),
    environment: "production",
  };
}

function feedbackFor({
  spec,
  effects,
  turn,
  failed,
  finishedAt,
  random,
}: {
  spec: DashboardsDemoProjectSpec;
  effects: ActiveEffect[];
  turn: Turn;
  failed: boolean;
  finishedAt: number;
  random: DemoRandom;
}): TrackEventRESTParamsValidator[] {
  if (!turn.isLastTurn || !random.chance(spec.coverage.feedback ?? 0)) return [];
  const down = shiftOf({ effects, get: (effect) => effect.feedbackDown });
  const action = turn.generativeAction;
  const happy = action
    ? action === "accepted" || action === "edited"
    : !failed && turn.outcome === "resolved";
  const up = clamp({
    value: (happy ? spec.thumbsUp + (1 - spec.thumbsUp) * 0.5 : spec.thumbsUp * 0.45) - down,
  });
  const vote = random.chance(up) ? 1 : -1;
  return [
    {
      event_id: `event_${turn.traceId}_thumbs`,
      trace_id: turn.traceId,
      event_type: "thumbs_up_down",
      metrics: { vote },
      event_details: vote < 0 && turn.reason ? { feedback: turn.reason } : {},
      timestamp: finishedAt + random.int({ min: 2_000, max: 120_000 }),
    },
  ];
}

/** Conversations per day, from traces per day and the archetype's turns per conversation. */
export function demoConversationsPerDay(input: {
  spec: DashboardsDemoProjectSpec;
  agent: DashboardsDemoAgent;
  day: DemoDay;
  scale: number;
}): number {
  return Math.max(1, Math.round(demoTracesPerDay(input) / averageTurns(input.spec)));
}
