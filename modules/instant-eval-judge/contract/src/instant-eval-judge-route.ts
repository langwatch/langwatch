/**
 * The judge router's contract: the route a call carries, the route table and per-backend prices
 * the deployment configures, and what a routed judgement reports about how it was answered.
 * @see modules/instant-eval-judge/specs/instant-eval-judge-router.feature
 */

import type { Named } from "@langwatch/module";
import { z } from "zod";

/** What is being judged: a search question, an LLM-judge evaluator or a scenario criterion. */
export const INSTANT_EVAL_JUDGE_JOBS = ["search", "llm_judge", "scenario_judge"] as const;
export type InstantEvalJudgeJob = (typeof INSTANT_EVAL_JUDGE_JOBS)[number];

/** Cheapest first: a mode with no usable entry falls back to the one before it. */
export const INSTANT_EVAL_JUDGE_MODES = ["instant", "balanced", "accurate"] as const;
export type InstantEvalJudgeMode = (typeof INSTANT_EVAL_JUDGE_MODES)[number];

/**
 * `text`: user and assistant messages, no tool calls or results. `tools`: the agent's tool calls
 * with their arguments and results, and the user request they answer. `full`: the whole trace.
 */
const INSTANT_EVAL_JUDGE_INPUT_VIEWS = ["text", "tools", "full"] as const;
export type InstantEvalJudgeInputView = (typeof INSTANT_EVAL_JUDGE_INPUT_VIEWS)[number];

/** The request shapes a routed backend speaks. */
const INSTANT_EVAL_JUDGE_BACKEND_KINDS = [
  "jev",
  "decisions",
  "anthropic_messages",
  "openai_responses",
  "gemini_generate_content",
] as const;
export type InstantEvalJudgeBackendKind = (typeof INSTANT_EVAL_JUDGE_BACKEND_KINDS)[number];

/** The kinds that answer as an LLM: one question per call, taken as sure. */
export const INSTANT_EVAL_JUDGE_LLM_KINDS = [
  "anthropic_messages",
  "openai_responses",
  "gemini_generate_content",
] as const satisfies readonly InstantEvalJudgeBackendKind[];
export type InstantEvalJudgeLlmKind = (typeof INSTANT_EVAL_JUDGE_LLM_KINDS)[number];

export function isInstantEvalJudgeLlmKind(
  kind: InstantEvalJudgeBackendKind | undefined,
): kind is InstantEvalJudgeLlmKind {
  return kind !== undefined && (INSTANT_EVAL_JUDGE_LLM_KINDS as readonly string[]).includes(kind);
}

/** A Gemini model id rides in the request path, so it is held to the characters an id uses. */
const GEMINI_MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * The reasoning effort an OpenAI Responses backend may be asked for; unset, the model's own.
 * Which values a model takes is the provider's, not checked here (ADR-190 decision 12).
 */
const INSTANT_EVAL_JUDGE_REASONING_EFFORTS = ["none", "minimal", "low", "medium", "high"] as const;
export type InstantEvalJudgeReasoningEffort = (typeof INSTANT_EVAL_JUDGE_REASONING_EFFORTS)[number];

/**
 * A reasoning model counts its reasoning against the output cap, so an effort other than `none`
 * gets the room OpenAI advises reserving for reasoning (25,000) plus the answer's.
 */
export const INSTANT_EVAL_JUDGE_REASONING_MAX_OUTPUT_TOKENS = 32_000;

/**
 * The shortest timeout a backend asked for an effort other than `none` may have, and its default:
 * the time a model takes to write the whole cap (about 110 tokens a second). A call cut off sooner
 * reads no usage, so what the provider charged for it is never billed (ADR-190 decision 12).
 */
export const INSTANT_EVAL_JUDGE_REASONING_TIMEOUT_FLOOR_MS = 300_000;

/**
 * How fast a reasoning model is taken to write its output, for a backend that sets its own cap:
 * the slow tenth of measured calls, end to end with the prompt read (ADR-190 decision 12).
 */
const REASONING_OUTPUT_TOKENS_PER_SECOND = 50;

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * The shortest timeout a reasoning backend may have: the time it takes to write its own output cap
 * where the table sets one, else the floor for the reasoning cap (ADR-190 decision 12).
 */
function instantEvalJudgeReasoningTimeoutFloorMsOf({
  maxOutputTokens,
}: {
  maxOutputTokens?: number | undefined;
}): number {
  return maxOutputTokens === undefined
    ? INSTANT_EVAL_JUDGE_REASONING_TIMEOUT_FLOOR_MS
    : Math.ceil((maxOutputTokens * 1_000) / REASONING_OUTPUT_TOKENS_PER_SECOND);
}

/** Whether an effort asks the model to reason, so the reasoning cap and timeout floor apply. */
export function isInstantEvalJudgeReasoning(
  effort: InstantEvalJudgeReasoningEffort | undefined,
): boolean {
  return effort !== undefined && effort !== "none";
}

/** The kinds that take a reasoning effort on the wire. */
const KINDS_TAKING_A_REASONING_EFFORT: readonly InstantEvalJudgeBackendKind[] = [
  "openai_responses",
];

/** The kinds whose calls write an answer, so the table may set their output cap. */
const KINDS_TAKING_AN_OUTPUT_CAP: readonly InstantEvalJudgeBackendKind[] = [
  "anthropic_messages",
  "openai_responses",
  "gemini_generate_content",
];

/**
 * The gate's frozen questions, versioned by name, with how many levels each scores on: a
 * threshold keeps its meaning with its name. The level wording lives in the process package's
 * instant-eval-judge-gate.rules.ts, whose unit test keeps the two counts equal.
 */
export const INSTANT_EVAL_JUDGE_GATE_QUESTIONS = {
  difficulty_v1: { levelCount: 5 },
} as const satisfies Record<string, Readonly<{ levelCount: number }>>;
export type InstantEvalJudgeGateQuestionName = keyof typeof INSTANT_EVAL_JUDGE_GATE_QUESTIONS;
const GATE_QUESTION_NAMES = Object.keys(INSTANT_EVAL_JUDGE_GATE_QUESTIONS) as [
  InstantEvalJudgeGateQuestionName,
  ...InstantEvalJudgeGateQuestionName[],
];

/** Where the arithmetic flag comes from: the caller, the question regex, or the caller first. */
const INSTANT_EVAL_JUDGE_ARITHMETIC_SOURCES = ["request", "regex", "request_then_regex"] as const;

/** The slot an arithmetic question takes instead of its length bucket. */
export const INSTANT_EVAL_JUDGE_ARITHMETIC_SLOT = "arithmetic";

/**
 * How sure a score answer is: `spread` reads the levels' weighted standard deviation against
 * half the range, so one level is sure and an even split between the ends is not.
 */
const INSTANT_EVAL_JUDGE_SCORE_SURENESS_RULES = ["spread"] as const;

/**
 * How sure a category answer is: `margin` is the likeliest option's probability less the
 * runner-up's, `top` the likeliest option's probability alone.
 */
const INSTANT_EVAL_JUDGE_CATEGORY_SURENESS_RULES = ["margin", "top"] as const;
export type InstantEvalJudgeSurenessRule =
  | (typeof INSTANT_EVAL_JUDGE_SCORE_SURENESS_RULES)[number]
  | (typeof INSTANT_EVAL_JUDGE_CATEGORY_SURENESS_RULES)[number];

/** The question kinds the table may route besides yes or no; one it leaves out is not routed. */
const INSTANT_EVAL_JUDGE_ROUTED_KINDS = ["score", "category"] as const;

const jobSchema = z.enum(INSTANT_EVAL_JUDGE_JOBS);
const modeSchema = z.enum(INSTANT_EVAL_JUDGE_MODES);
const inputViewSchema = z.enum(INSTANT_EVAL_JUDGE_INPUT_VIEWS);
const backendKindsSchema = z.array(z.enum(INSTANT_EVAL_JUDGE_BACKEND_KINDS)).readonly();

/**
 * A difficulty gate: before any answer, a hosted classifier backend scores how hard the case is
 * on the named question's levels (0 the easiest). A score under `easyBelow` (at most the top
 * level) sends the question to `primary` alone, anything else (no score too) to `escalateTo`.
 */
const routeGateSchema = z
  .object({
    backend: z.string().min(1),
    question: z.enum(GATE_QUESTION_NAMES),
    easyBelow: z.number().gt(0),
  })
  .readonly();
export type InstantEvalJudgeRouteGate = z.infer<typeof routeGateSchema>;

/**
 * One way to answer: a primary, and either an escalation past a threshold, a parallel pair, or a
 * gate that picks between the primary and the escalation before either is asked.
 */
const routeEntrySchema = z
  .object({
    primary: z.string().min(1),
    escalateTo: z.string().min(1).optional(),
    /**
     * Escalate when the answer's sureness is below it. Yes or no: |2p - 1|, so 0.7 escalates
     * 0.15 < p < 0.85. A score or a category: its kind's sureness rule, also from 0 to 1.
     */
    threshold: z.number().gt(0).lte(1).optional(),
    pairWith: z.string().min(1).optional(),
    gate: routeGateSchema.optional(),
  })
  .readonly();
export type InstantEvalJudgeRouteEntry = z.infer<typeof routeEntrySchema>;

/** Every slot answers instant, the end of every mode fallback. */
const routeSlotSchema = z
  .object({
    instant: routeEntrySchema,
    balanced: routeEntrySchema.optional(),
    accurate: routeEntrySchema.optional(),
  })
  .readonly();
export type InstantEvalJudgeRouteSlot = z.infer<typeof routeSlotSchema>;

const backendSchema = z
  .object({
    kind: z.enum(INSTANT_EVAL_JUDGE_BACKEND_KINDS),
    /** The provider's model id; a Decisions or LLM backend must name one, there is no default. */
    model: z.string().min(1).optional(),
    enabled: z.boolean().default(true),
    /**
     * Unset, 30 s, or the reasoning floor when the backend sets an effort other than `none`: the
     * time to write its own output cap where it sets one.
     */
    timeoutMs: z.number().int().positive().optional(),
    /** Tried in order when this backend cannot answer. */
    fallbacks: z.array(z.string().min(1)).readonly().default([]),
    /** Sent with every call of an OpenAI Responses backend; unset, the request names none. */
    reasoningEffort: z.enum(INSTANT_EVAL_JUDGE_REASONING_EFFORTS).optional(),
    /** An LLM backend's output cap, reasoning included; unset, the leg's default cap. */
    maxOutputTokens: z.number().int().positive().optional(),
  })
  .transform(({ timeoutMs, ...backend }) => ({
    ...backend,
    timeoutMs:
      timeoutMs ??
      (isInstantEvalJudgeReasoning(backend.reasoningEffort)
        ? instantEvalJudgeReasoningTimeoutFloorMsOf(backend)
        : DEFAULT_TIMEOUT_MS),
  }))
  .readonly();
type InstantEvalJudgeBackend = z.infer<typeof backendSchema>;

const perJob = <T extends z.ZodType>(schema: T) =>
  z.object({ search: schema, llm_judge: schema, scenario_judge: schema });

/**
 * One question kind's routes: the slot any job, bucket or arithmetic call takes unless `routes`
 * names its own. A job's arithmetic call with no arithmetic slot takes its length bucket's.
 */
const kindRoutingSchema = <T extends readonly [string, ...string[]]>(rules: T) =>
  z
    .object({
      sureness: z.enum(rules),
      default: routeSlotSchema,
      routes: perJob(z.record(z.string(), routeSlotSchema)).partial().strict().default({}),
    })
    .strict()
    .readonly();

const kindsSchema = z
  .object({
    score: kindRoutingSchema(INSTANT_EVAL_JUDGE_SCORE_SURENESS_RULES).optional(),
    category: kindRoutingSchema(INSTANT_EVAL_JUDGE_CATEGORY_SURENESS_RULES).optional(),
  })
  // A misspelt kind or job would otherwise vanish and leave those questions unrouted unseen.
  .strict()
  .readonly();

const instantEvalJudgeRouteTableSchemaDefinition = z
  .object({
    version: z.number().int().positive(),
    defaultMode: perJob(modeSchema),
    /** By token count of the judged view, upper bound inclusive; the last is open. */
    buckets: z
      .array(
        z.object({ name: z.string().min(1), maxTokens: z.number().int().positive().nullable() }),
      )
      .min(1),
    arithmetic: z.object({
      /** Longer inputs use their length bucket even when the flag is set. */
      maxTokens: z.number().int().nonnegative(),
      source: perJob(z.enum(INSTANT_EVAL_JUDGE_ARITHMETIC_SOURCES)),
    }),
    /**
     * The view a question category judges when the call names none, by question meaning:
     * wording to `text`, tool use to `tools`, outcomes to `full` (today's, the default).
     */
    inputViews: z
      .object({
        default: inputViewSchema,
        byCategory: z.record(z.string(), inputViewSchema),
        /** Backend kinds that may judge a partial view as a primary or pair; others get `full`. */
        allowedKinds: z
          .object({ text: backendKindsSchema, tools: backendKindsSchema })
          .default({ text: ["decisions"], tools: [] }),
      })
      .default({
        default: "full",
        byCategory: {},
        allowedKinds: { text: ["decisions"], tools: [] },
      }),
    backends: z.record(z.string(), backendSchema),
    /** Yes-or-no questions' slots. */
    routes: perJob(z.record(z.string(), routeSlotSchema)),
    /** Score and category questions' slots; a kind left out takes today's classifier call. */
    kinds: kindsSchema.default({}),
    /**
     * The LLM backend that answers a scenario judge's turn decision (go on, or judge now). That
     * phase is not routed; a table without it answers no turn decision.
     */
    scenarioDecision: z
      .object({ backend: z.string().min(1) })
      .readonly()
      .optional(),
  })
  .superRefine((table, ctx) => {
    for (const issue of routeTableIssues(table)) ctx.addIssue({ code: "custom", message: issue });
  });
export interface InstantEvalJudgeRouteTableSchema extends Named<
  typeof instantEvalJudgeRouteTableSchemaDefinition
> {}
export const instantEvalJudgeRouteTableSchema: InstantEvalJudgeRouteTableSchema =
  instantEvalJudgeRouteTableSchemaDefinition;
export type InstantEvalJudgeRouteTable = z.infer<typeof instantEvalJudgeRouteTableSchema>;

type RouteTableShape = z.output<typeof instantEvalJudgeRouteTableSchemaDefinition>;

/** What makes a table unroutable; the config refuses to boot on any of them. */
function routeTableIssues(table: RouteTableShape): string[] {
  const issues: string[] = bucketIssues(table.buckets);
  const slotKeys = [...table.buckets.map((b) => b.name), INSTANT_EVAL_JUDGE_ARITHMETIC_SLOT];
  for (const job of INSTANT_EVAL_JUDGE_JOBS) {
    for (const key of slotKeys) {
      const slot = table.routes[job][key];
      if (!slot) {
        issues.push(`${job} / ${key}: the route table has no slot`);
        continue;
      }
      issues.push(...slotIssues({ table, slot, where: `${job} / ${key}` }));
    }
  }
  for (const [name, backend] of Object.entries(table.backends)) {
    issues.push(...backendIssues({ table, name, backend }));
  }
  issues.push(...kindIssues({ table, slotKeys }));
  issues.push(...scenarioDecisionIssues(table));
  return issues;
}

/** The turn decision is the judge's own tool call, which only an LLM backend can take. */
function scenarioDecisionIssues(table: RouteTableShape): string[] {
  const name = table.scenarioDecision?.backend;
  if (name === undefined) return [];
  if (!table.backends[name]) return [`scenarioDecision: unknown backend ${name}`];
  if (!isLlmBackendOf(table)(name)) return [`scenarioDecision: ${name} is not an LLM backend`];
  return [];
}

/** Each routed kind's default slot and every slot it names, on known jobs and slot keys. */
function kindIssues({
  table,
  slotKeys,
}: {
  table: RouteTableShape;
  slotKeys: readonly string[];
}): string[] {
  const issues: string[] = [];
  for (const kind of INSTANT_EVAL_JUDGE_ROUTED_KINDS) {
    const routing = table.kinds[kind];
    if (!routing) continue;
    issues.push(...slotIssues({ table, slot: routing.default, where: `${kind} / default` }));
    for (const job of INSTANT_EVAL_JUDGE_JOBS) {
      for (const [key, slot] of Object.entries(routing.routes[job] ?? {})) {
        const where = `${kind} / ${job} / ${key}`;
        if (!slotKeys.includes(key)) issues.push(`${where}: not a bucket or the arithmetic slot`);
        issues.push(...slotIssues({ table, slot, where }));
      }
    }
  }
  return issues;
}

/**
 * Every slot of the table, yes-or-no and per routed kind, so a check misses none. With `jobs`,
 * only the slots those jobs can take: theirs, and each routed kind's default, which any job takes.
 */
export function instantEvalJudgeRouteSlotsOf(
  table: InstantEvalJudgeRouteTable,
  jobs: readonly InstantEvalJudgeJob[] = INSTANT_EVAL_JUDGE_JOBS,
): InstantEvalJudgeRouteSlot[] {
  const slots = jobs.flatMap((job) => Object.values(table.routes[job]));
  for (const kind of INSTANT_EVAL_JUDGE_ROUTED_KINDS) {
    const routing = table.kinds[kind];
    if (!routing) continue;
    slots.push(routing.default);
    for (const job of jobs) slots.push(...Object.values(routing.routes[job] ?? {}));
  }
  return slots;
}

/** Unique names, bounds strictly ascending, and only the last bucket open. */
function bucketIssues(buckets: RouteTableShape["buckets"]): string[] {
  const issues: string[] = [];
  const names = buckets.map((bucket) => bucket.name);
  if (new Set(names).size !== names.length) issues.push("bucket names must be unique");
  let previous = 0;
  buckets.forEach((bucket, at) => {
    const isLast = at === buckets.length - 1;
    if (bucket.maxTokens === null) {
      if (!isLast) issues.push(`bucket ${bucket.name}: only the last bucket may be open`);
      return;
    }
    if (isLast) issues.push("the last bucket must be open (maxTokens null)");
    if (bucket.maxTokens <= previous) {
      issues.push(`bucket ${bucket.name}: maxTokens must be above the bucket before it`);
    }
    previous = bucket.maxTokens;
  });
  return issues;
}

/** The kinds that cannot answer without a model id in the table: there is no default. */
const KINDS_NEEDING_A_MODEL: readonly InstantEvalJudgeBackendKind[] = [
  "decisions",
  ...INSTANT_EVAL_JUDGE_LLM_KINDS,
];

function backendIssues({
  table,
  name,
  backend,
}: {
  table: RouteTableShape;
  name: string;
  backend: InstantEvalJudgeBackend;
}): string[] {
  const issues = backendKindIssues({ name, backend });
  const floorMs = instantEvalJudgeReasoningTimeoutFloorMsOf(backend);
  if (isInstantEvalJudgeReasoning(backend.reasoningEffort) && backend.timeoutMs < floorMs) {
    const cap =
      backend.maxOutputTokens === undefined
        ? ""
        : ` and maxOutputTokens ${backend.maxOutputTokens}`;
    issues.push(
      `backend ${name}: reasoningEffort ${backend.reasoningEffort}${cap} needs a timeoutMs of at least ${floorMs}`,
    );
  }
  for (const fallback of backend.fallbacks) {
    if (!table.backends[fallback]) issues.push(`backend ${name}: unknown fallback ${fallback}`);
    if (fallback === name) issues.push(`backend ${name}: lists itself as a fallback`);
  }
  return issues;
}

/** What the backend's kind allows: a model id, a reasoning effort, an output cap. */
function backendKindIssues({
  name,
  backend,
}: {
  name: string;
  backend: InstantEvalJudgeBackend;
}): string[] {
  const issues: string[] = [];
  if (KINDS_NEEDING_A_MODEL.includes(backend.kind) && !backend.model) {
    issues.push(`backend ${name}: a ${backend.kind} backend must name its model`);
  }
  if (
    backend.kind === "gemini_generate_content" &&
    backend.model &&
    !GEMINI_MODEL_ID.test(backend.model)
  ) {
    issues.push(`backend ${name}: a gemini_generate_content model is a bare model id`);
  }
  if (
    backend.reasoningEffort !== undefined &&
    !KINDS_TAKING_A_REASONING_EFFORT.includes(backend.kind)
  ) {
    issues.push(`backend ${name}: a ${backend.kind} backend takes no reasoningEffort`);
  }
  if (backend.maxOutputTokens !== undefined && !KINDS_TAKING_AN_OUTPUT_CAP.includes(backend.kind)) {
    issues.push(`backend ${name}: a ${backend.kind} backend takes no maxOutputTokens`);
  }
  return issues;
}

function slotIssues({
  table,
  slot,
  where,
}: {
  table: RouteTableShape;
  slot: InstantEvalJudgeRouteSlot;
  where: string;
}): string[] {
  const issues: string[] = [];
  for (const mode of INSTANT_EVAL_JUDGE_MODES) {
    const entry = slot[mode];
    if (entry) issues.push(...entryIssues({ table, entry, where: `${where} / ${mode}` }));
  }
  const instantOff = instantEvalJudgeEntryBackends(slot.instant).some(
    (backend) => table.backends[backend]?.enabled === false,
  );
  if (instantOff) issues.push(`${where}: the instant entry must name enabled backends only`);
  return issues;
}

function entryIssues({
  table,
  entry,
  where,
}: {
  table: RouteTableShape;
  entry: InstantEvalJudgeRouteEntry;
  where: string;
}): string[] {
  const issues: string[] = [];
  for (const backend of instantEvalJudgeEntryBackends(entry)) {
    if (!table.backends[backend]) issues.push(`${where}: unknown backend ${backend}`);
  }
  if (entry.escalateTo && entry.threshold === undefined && !entry.gate) {
    issues.push(`${where}: escalateTo needs a threshold or a gate`);
  }
  if (entry.gate) issues.push(...gateIssues({ table, entry, gate: entry.gate, where }));
  if (entry.escalateTo && entry.pairWith) {
    issues.push(`${where}: an entry escalates or pairs, not both`);
  }
  const pairsAnLlm =
    entry.pairWith !== undefined && pairMembersOf({ table, entry }).some(isLlmBackendOf(table));
  if (pairsAnLlm) {
    issues.push(`${where}: a pair or its fallbacks may not be an LLM backend`);
  }
  return issues;
}

/**
 * A gate picks between the primary and the escalation, so it needs both and neither a threshold
 * nor a pair; only the hosted classifier answers its question, once, no fallback; its threshold
 * is at most the question's top level.
 */
function gateIssues({
  table,
  entry,
  gate,
  where,
}: {
  table: RouteTableShape;
  entry: InstantEvalJudgeRouteEntry;
  gate: InstantEvalJudgeRouteGate;
  where: string;
}): string[] {
  const issues: string[] = [];
  if (!entry.escalateTo) issues.push(`${where}: a gate needs an escalateTo`);
  if (entry.threshold !== undefined || entry.pairWith) {
    issues.push(`${where}: a gate takes no threshold and no pair`);
  }
  const topLevel = INSTANT_EVAL_JUDGE_GATE_QUESTIONS[gate.question].levelCount - 1;
  if (gate.easyBelow > topLevel) {
    issues.push(
      `${where}: the gate's easyBelow must be at most ${gate.question}'s top level ${topLevel}`,
    );
  }
  const backend = table.backends[gate.backend];
  if (backend && backend.kind !== "jev") {
    issues.push(`${where}: the gate backend ${gate.backend} must be a jev backend`);
  }
  if (backend && backend.fallbacks.length > 0) {
    issues.push(`${where}: the gate backend ${gate.backend} takes no fallbacks`);
  }
  return issues;
}

/** A pair's two backends and their fallbacks, any of which may answer for a pair leg. */
function pairMembersOf({
  table,
  entry,
}: {
  table: RouteTableShape;
  entry: InstantEvalJudgeRouteEntry;
}): string[] {
  const legs = [entry.primary, entry.pairWith ?? entry.primary];
  return [...legs, ...legs.flatMap((name) => table.backends[name]?.fallbacks ?? [])];
}

/**
 * An LLM answers yes or no, a probability of one or zero, so it would always win a pair's
 * confidence pick; pairs are for decision models, and an LLM only escalates.
 */
function isLlmBackendOf(table: RouteTableShape) {
  return (name: string): boolean => {
    return isInstantEvalJudgeLlmKind(table.backends[name]?.kind);
  };
}

/** Whether a backend answers as an LLM: one question per call, taken as sure. */
export function isInstantEvalJudgeLlmBackend({
  backend,
  table,
}: {
  backend: string;
  table: InstantEvalJudgeRouteTable;
}): boolean {
  return isLlmBackendOf(table)(backend);
}

/** Every backend an entry may call, its gate included, in the order it may call them. */
export function instantEvalJudgeEntryBackends(entry: InstantEvalJudgeRouteEntry): string[] {
  return [entry.gate?.backend, entry.primary, entry.pairWith, entry.escalateTo].filter(
    (backend): backend is string => backend !== undefined,
  );
}

/** Whether every backend an entry may call is switched on; an entry with one off is unusable. */
export function isInstantEvalJudgeEntryEnabled({
  entry,
  table,
}: {
  entry: InstantEvalJudgeRouteEntry;
  table: InstantEvalJudgeRouteTable;
}): boolean {
  return instantEvalJudgeEntryBackends(entry).every(
    (name) => table.backends[name]?.enabled === true,
  );
}

/** A backend's fallbacks that are switched on, in the order they are tried. */
export function instantEvalJudgeEnabledFallbacksOf({
  backend,
  table,
}: {
  backend: string;
  table: InstantEvalJudgeRouteTable;
}): string[] {
  return (table.backends[backend]?.fallbacks ?? []).filter(
    (fallback) => table.backends[fallback]?.enabled === true,
  );
}

/** The public table: every slot asks the hosted classifier alone, which is today's call. */
export const INSTANT_EVAL_JUDGE_DEFAULT_ROUTE_TABLE: InstantEvalJudgeRouteTable =
  instantEvalJudgeRouteTableSchema.parse({
    version: 1,
    defaultMode: { search: "balanced", llm_judge: "balanced", scenario_judge: "balanced" },
    buckets: [{ name: "all", maxTokens: null }],
    arithmetic: {
      maxTokens: 0,
      source: { search: "request", llm_judge: "request", scenario_judge: "request" },
    },
    // The whole page lease, so the classifier's own retries run as they do unrouted.
    backends: { jev: { kind: "jev", timeoutMs: 600_000 } },
    routes: Object.fromEntries(
      INSTANT_EVAL_JUDGE_JOBS.map((job) => [
        job,
        { all: { instant: { primary: "jev" } }, arithmetic: { instant: { primary: "jev" } } },
      ]),
    ),
  });

/** USD per million tokens; above `longContext.aboveInputTokens` the long rate applies. */
const backendPriceSchema = z
  .object({
    usdPerMillionInputTokens: z.number().nonnegative(),
    usdPerMillionOutputTokens: z.number().nonnegative().default(0),
    longContext: z
      .object({
        aboveInputTokens: z.number().int().positive(),
        usdPerMillionInputTokens: z.number().nonnegative(),
        usdPerMillionOutputTokens: z.number().nonnegative().default(0),
      })
      .optional(),
  })
  .readonly();

const instantEvalJudgeRoutePricingSchemaDefinition = z.object({
  /** Stamped on the priced fact, so a replay is told from a re-rating. */
  version: z.string().min(1),
  /** No markup here: every Instant Eval price takes the one published markup. */
  backends: z.record(z.string(), backendPriceSchema),
});
export interface InstantEvalJudgeRoutePricingSchema extends Named<
  typeof instantEvalJudgeRoutePricingSchemaDefinition
> {}
export const instantEvalJudgeRoutePricingSchema: InstantEvalJudgeRoutePricingSchema =
  instantEvalJudgeRoutePricingSchemaDefinition;
export type InstantEvalJudgeRoutePricing = z.infer<typeof instantEvalJudgeRoutePricingSchema>;

const instantEvalJudgeRouteRequestSchemaDefinition = z
  .object({
    job: jobSchema,
    /** Absent, the job's default mode in the table. */
    mode: modeSchema.optional(),
    /** The caller's arithmetic flag, read when the table's source for the job allows it. */
    arithmetic: z.boolean().optional(),
    /** Absent, the table's mapping from `questionCategory`, else its default view. */
    inputView: inputViewSchema.optional(),
    /** e.g. sentiment, intent, language, handoff, tool_args, grounding; a key of the mapping. */
    questionCategory: z.string().min(1).optional(),
    /** The partial views the caller rendered; a plan for a view not sent judges the full text. */
    views: z.object({ text: z.string().optional(), tools: z.string().optional() }).optional(),
    /** Token count of the judged view; estimated from its bytes when absent. */
    tokens: z.number().int().nonnegative().optional(),
  })
  .readonly();
export interface InstantEvalJudgeRouteRequestSchema extends Named<
  typeof instantEvalJudgeRouteRequestSchemaDefinition
> {}
export const instantEvalJudgeRouteRequestSchema: InstantEvalJudgeRouteRequestSchema =
  instantEvalJudgeRouteRequestSchemaDefinition;
export type InstantEvalJudgeRouteRequest = z.infer<typeof instantEvalJudgeRouteRequestSchema>;

/** How a routed judgement was answered; never a provider's error text. */
export interface InstantEvalJudgeRouting {
  /** Verdicts each backend supplied, by backend name. */
  readonly answeredBy: Readonly<Record<string, number>>;
  /**
   * Questions an unsure or failed primary sent to the escalation. A gate's hard branch is a
   * routing choice, reported by the `gate:hard` flag, and is not counted here.
   */
  readonly escalated: number;
  readonly mode: InstantEvalJudgeMode;
  readonly slot: string;
  readonly inputView: InstantEvalJudgeInputView;
  /** e.g. `escalation_failed`, `fallback:decisions->jev`, `tools_view_refused`, `gate:hard`. */
  readonly flags: readonly string[];
}
