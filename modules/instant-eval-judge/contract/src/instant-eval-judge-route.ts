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
export const INSTANT_EVAL_JUDGE_INPUT_VIEWS = ["text", "tools", "full"] as const;
export type InstantEvalJudgeInputView = (typeof INSTANT_EVAL_JUDGE_INPUT_VIEWS)[number];

/** The request shapes a routed backend speaks. */
export const INSTANT_EVAL_JUDGE_BACKEND_KINDS = [
  "jev",
  "decisions",
  "anthropic_messages",
  "openai_responses",
] as const;
export type InstantEvalJudgeBackendKind = (typeof INSTANT_EVAL_JUDGE_BACKEND_KINDS)[number];

/** Where the arithmetic flag comes from: the caller, the question regex, or the caller first. */
export const INSTANT_EVAL_JUDGE_ARITHMETIC_SOURCES = [
  "request",
  "regex",
  "request_then_regex",
] as const;

/** The slot an arithmetic question takes instead of its length bucket. */
export const INSTANT_EVAL_JUDGE_ARITHMETIC_SLOT = "arithmetic";

const jobSchema = z.enum(INSTANT_EVAL_JUDGE_JOBS);
const modeSchema = z.enum(INSTANT_EVAL_JUDGE_MODES);
const inputViewSchema = z.enum(INSTANT_EVAL_JUDGE_INPUT_VIEWS);
const backendKindsSchema = z.array(z.enum(INSTANT_EVAL_JUDGE_BACKEND_KINDS)).readonly();

/** One way to answer: a primary, and either an escalation past a threshold or a parallel pair. */
const routeEntrySchema = z
  .object({
    primary: z.string().min(1),
    escalateTo: z.string().min(1).optional(),
    /** Escalate when |2p - 1| is below it: 0.7 escalates 0.15 < p < 0.85. */
    threshold: z.number().gt(0).lte(1).optional(),
    pairWith: z.string().min(1).optional(),
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
    timeoutMs: z.number().int().positive().default(30_000),
    /** Tried in order when this backend cannot answer. */
    fallbacks: z.array(z.string().min(1)).readonly().default([]),
  })
  .readonly();
export type InstantEvalJudgeBackend = z.infer<typeof backendSchema>;

const perJob = <T extends z.ZodType>(schema: T) =>
  z.object({ search: schema, llm_judge: schema, scenario_judge: schema });

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
    routes: perJob(z.record(z.string(), routeSlotSchema)),
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
  return issues;
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
  "anthropic_messages",
  "openai_responses",
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
  const issues: string[] = [];
  if (KINDS_NEEDING_A_MODEL.includes(backend.kind) && !backend.model) {
    issues.push(`backend ${name}: a ${backend.kind} backend must name its model`);
  }
  for (const fallback of backend.fallbacks) {
    if (!table.backends[fallback]) issues.push(`backend ${name}: unknown fallback ${fallback}`);
    if (fallback === name) issues.push(`backend ${name}: lists itself as a fallback`);
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
  if (entry.escalateTo && entry.threshold === undefined) {
    issues.push(`${where}: escalateTo needs a threshold`);
  }
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
    const kind = table.backends[name]?.kind;
    return kind === "anthropic_messages" || kind === "openai_responses";
  };
}

/** Every backend an entry may call, in the order it may call them. */
export function instantEvalJudgeEntryBackends(entry: InstantEvalJudgeRouteEntry): string[] {
  return [entry.primary, entry.pairWith, entry.escalateTo].filter(
    (backend): backend is string => backend !== undefined,
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
export type InstantEvalJudgeBackendPrice = z.infer<typeof backendPriceSchema>;

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

const instantEvalJudgeRouteSchemaDefinition = z
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
export interface InstantEvalJudgeRouteSchema extends Named<
  typeof instantEvalJudgeRouteSchemaDefinition
> {}
export const instantEvalJudgeRouteSchema: InstantEvalJudgeRouteSchema =
  instantEvalJudgeRouteSchemaDefinition;
export type InstantEvalJudgeRoute = z.infer<typeof instantEvalJudgeRouteSchema>;

/** How a routed judgement was answered; never a provider's error text. */
export interface InstantEvalJudgeRouting {
  /** Verdicts each backend supplied, by backend name. */
  readonly answeredBy: Readonly<Record<string, number>>;
  /** Questions an unsure or failed primary sent to the escalation. */
  readonly escalated: number;
  readonly mode: InstantEvalJudgeMode;
  readonly slot: string;
  readonly inputView: InstantEvalJudgeInputView;
  /** e.g. `escalation_failed`, `fallback:decisions->jev`, `tools_view_refused`. */
  readonly flags: readonly string[];
}
