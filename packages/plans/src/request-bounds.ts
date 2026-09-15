/**
 * The single registry of numeric request bounds, resolved on three tiers —
 * free, paid, enterprise — by {@link resolveRequestBound}: ENTERPRISE and
 * self-hosted OPEN_SOURCE answer enterprise, FREE/LAUNCH/unknown answer free, the rest paid.
 */

import { PLAN_TYPES } from "./plan-type.ts";

/** What a bound is counted in; a number without its unit reads two ways on two screens. */
export const REQUEST_BOUND_UNITS = [
  "items",
  "bytes",
  "slots",
  "seconds",
  "requests-per-minute",
  "requests-per-hour",
] as const;
export type RequestBoundUnit = (typeof REQUEST_BOUND_UNITS)[number];

/** The three tiers a bound is quoted in. */
export const REQUEST_BOUND_TIERS = ["free", "paid", "enterprise"] as const;
export type RequestBoundTier = (typeof REQUEST_BOUND_TIERS)[number];

export interface RequestBound {
  readonly key: string;
  readonly description: string;
  readonly unit: RequestBoundUnit;
  /** FREE, LAUNCH, unknown plan types, and no plan at all. */
  readonly free: number;
  /** PRO, GROWTH, ACCELERATE and their seat, currency and annual variants. */
  readonly paid: number;
  /** ENTERPRISE and self-hosted OPEN_SOURCE. */
  readonly enterprise: number;
}

const MiB = 1024 * 1024;

/**
 * Every bound LangWatch enforces. Tier-aware entries carry
 * `enterprise = 2 * paid = 4 * free`; tier-agnostic ones state one number
 * three times so a reader never has to ask which kind they are looking at.
 */
export const requestBounds = [
  {
    key: "tracesPageSizeMax",
    description: "Trace page size clamp, traces tRPC and REST.",
    unit: "items",
    free: 1_000,
    paid: 2_000,
    enterprise: 4_000,
  },
  {
    key: "traceIdsMax",
    description: "Trace id arrays above this are refused, traces tRPC.",
    unit: "items",
    free: 1_000,
    paid: 2_000,
    enterprise: 4_000,
  },
  {
    key: "annotationPageSizeMax",
    description: "Annotation page size clamp.",
    unit: "items",
    free: 100,
    paid: 200,
    enterprise: 400,
  },
  {
    key: "annotationQueueTakeMax",
    description: "Annotation queue take clamp, allQueueItems.",
    unit: "items",
    free: 1_000,
    paid: 2_000,
    enterprise: 4_000,
  },
  {
    key: "datasetBatchMax",
    description: "Dataset entries/recordIds arrays above this are refused.",
    unit: "items",
    free: 1_000,
    paid: 2_000,
    enterprise: 4_000,
  },
  {
    key: "experimentInlineRowsMax",
    description: "Experiment inline rows above this are refused.",
    unit: "items",
    free: 1_000,
    paid: 2_000,
    enterprise: 4_000,
  },
  {
    key: "promptMessagesMax",
    description: "Prompt message arrays above this are refused.",
    unit: "items",
    free: 100,
    paid: 200,
    enterprise: 400,
  },
  {
    key: "exportConcurrencyPerProject",
    description: "In-flight trace exports per project.",
    unit: "slots",
    free: 2,
    paid: 4,
    enterprise: 8,
  },
  {
    key: "exportPerMinute",
    description: "Trace exports per caller per minute.",
    unit: "requests-per-minute",
    free: 6,
    paid: 12,
    enterprise: 24,
  },
  {
    key: "promptExecutePerMinute",
    description: "Prompt executes per caller per minute.",
    unit: "requests-per-minute",
    free: 30,
    paid: 60,
    enterprise: 120,
  },
  {
    key: "scenarioGeneratePerMinute",
    description: "Scenario generations per caller per minute.",
    unit: "requests-per-minute",
    free: 10,
    paid: 20,
    enterprise: 40,
  },
  {
    key: "langyTurnsPerMinute",
    description: "Langy turns per caller per minute.",
    unit: "requests-per-minute",
    free: 20,
    paid: 40,
    enterprise: 80,
  },
  {
    key: "webhookTestPerMinute",
    description: "Webhook test dispatches per caller per minute.",
    unit: "requests-per-minute",
    free: 10,
    paid: 20,
    enterprise: 40,
  },
  {
    key: "invitesCreatedPerHour",
    description: "Organization invites per sender per hour.",
    unit: "requests-per-hour",
    free: 100,
    paid: 200,
    enterprise: 400,
  },
  {
    key: "evaluationRunsPerMinute",
    description: "Evaluation runs per caller per minute.",
    unit: "requests-per-minute",
    free: 6,
    paid: 12,
    enterprise: 24,
  },
  {
    key: "lwqlPerMinute",
    description: "LWQL executions per caller per minute.",
    unit: "requests-per-minute",
    free: 30,
    paid: 60,
    enterprise: 120,
  },
  {
    key: "githubApiPerMinute",
    description: "GitHub API calls per caller per minute.",
    unit: "requests-per-minute",
    free: 6,
    paid: 12,
    enterprise: 24,
  },
  {
    key: "bodyLimitJsonBytes",
    description: "Raw-body JSON/control route body limit.",
    unit: "bytes",
    free: 1 * MiB,
    paid: 1 * MiB,
    enterprise: 1 * MiB,
  },
  {
    key: "bodyLimitBulkBytes",
    description: "OTLP wire, execute and export download body limit.",
    unit: "bytes",
    free: 10 * MiB,
    paid: 10 * MiB,
    enterprise: 10 * MiB,
  },
  {
    key: "authValidatePerIpPerMinute",
    description: "Token-oracle validate calls per IP per minute.",
    unit: "requests-per-minute",
    free: 30,
    paid: 30,
    enterprise: 30,
  },
  {
    key: "datasetFileBytes",
    description: "Dataset upload content, measured on the server.",
    unit: "bytes",
    free: 25 * MiB,
    paid: 25 * MiB,
    enterprise: 25 * MiB,
  },
  {
    key: "datasetRowsMax",
    description: "Dataset upload row count.",
    unit: "items",
    free: 10_000,
    paid: 10_000,
    enterprise: 10_000,
  },
  {
    key: "githubRepoListCacheSeconds",
    description: "GitHub installation repository listing cache TTL.",
    unit: "seconds",
    free: 60,
    paid: 60,
    enterprise: 60,
  },
] as const satisfies readonly RequestBound[];

export type RequestBoundKey = (typeof requestBounds)[number]["key"];

/** Every registry key, for validators that check a spelling against the table. */
export const REQUEST_BOUND_KEYS: readonly RequestBoundKey[] = requestBounds.map(
  (bound) => bound.key,
);

/** Per-tier overrides for one bound; any subset of the three tiers may be overridden. */
export type RequestBoundTierOverrides = Readonly<Partial<Record<RequestBoundTier, number>>>;

/**
 * Boot overrides for registry bounds, keyed by registry key. A plain positive
 * integer overrides every tier; a partial tier record overrides the tiers it
 * names and leaves the rest on the registry values.
 */
export type RequestBoundsOverrides = Readonly<
  Partial<Record<RequestBoundKey, number | RequestBoundTierOverrides>>
>;

const requestBoundByKey: ReadonlyMap<string, RequestBound> = new Map(
  requestBounds.map((bound) => [bound.key, bound]),
);

/** The registry entry one key names, or undefined for a spelling the registry has no bound for. */
export function findRequestBound(key: string): RequestBound | undefined {
  return requestBoundByKey.get(key);
}

/**
 * Plan types that answer the enterprise bound. Equality, not ordering, so an
 * unknown plan type refuses open rather than passing — the same semantics
 * `isEnterpriseTier` carries in the Enterprise plan gate.
 */
export const ENTERPRISE_PLAN_TYPES: ReadonlySet<string> = new Set(["ENTERPRISE"]);

/**
 * Plan types the automation persist cap counts as free; kept with the
 * registry so every tier test reads one table.
 */
export const FREE_PLAN_TYPES: ReadonlySet<string> = new Set(["FREE", "LAUNCH"]);

const PLAN_TYPE_SET: ReadonlySet<string> = new Set(PLAN_TYPES);

/**
 * The tier ladder one plan type answers on: ENTERPRISE and self-hosted
 * OPEN_SOURCE resolve to the enterprise bounds, FREE/LAUNCH to the free
 * bounds, every other known type to paid; unknown types refuse open to free.
 */
export function resolveRequestBoundTier(planType: string | null | undefined): RequestBoundTier {
  if (planType === null || planType === undefined) return "free";
  if (ENTERPRISE_PLAN_TYPES.has(planType) || planType === "OPEN_SOURCE") return "enterprise";
  if (FREE_PLAN_TYPES.has(planType)) return "free";
  if (PLAN_TYPE_SET.has(planType)) return "paid";
  return "free";
}

/**
 * The bound `key` answers under `planType`: a plain-number override wins on
 * every tier, a partial tier record on the tiers it names, and the rest
 * resolve through {@link resolveRequestBoundTier}. Throws on unknown keys.
 */
export function resolveRequestBound(
  key: RequestBoundKey,
  planType: string | null | undefined,
  overrides?: RequestBoundsOverrides,
): number {
  const bound = requestBoundByKey.get(key);
  if (bound === undefined) {
    throw new Error(`Unknown request bound: ${String(key)}.`);
  }

  const override = overrides?.[key];
  if (typeof override === "number") return override;

  const tier = resolveRequestBoundTier(planType);
  const tierOverride = override?.[tier];
  if (tierOverride !== undefined) return tierOverride;

  return bound[tier];
}
