import type { Named } from "@langwatch/module";
/**
 * One vocabulary for every card shape: Measured (CLI-generated) and Derived
 * (Langy JSON inline) channels share it but differ in tolerance — measured
 * preserves unknown fields, derived validates strictly. ADR-079, ADR-060.
 */
import * as z from "zod";

import {
  collectionSchema,
  hitsPaginationSchema,
  paginationSchema,
  rowOrTruncationMarker,
  textValueSchema,
} from "./primitives.ts";

/**
 * One trace, as the traces API spells it — which is, unhelpfully, two ways at
 * once: `trace_id` on the raw search document, `traceId` on some serialisers.
 * Both are accepted and neither is invented.
 */
const traceSummarySchemaDefinition = z.looseObject({
  trace_id: z.string().optional(),
  traceId: z.string().optional(),
  input: textValueSchema.optional(),
  output: textValueSchema.optional(),
  timestamps: z.looseObject({ started_at: z.number().optional() }).optional(),
  error: z.unknown().optional(),
});
export interface TraceSummarySchema extends Named<typeof traceSummarySchemaDefinition> {}
export const traceSummarySchema: TraceSummarySchema = traceSummarySchemaDefinition;

export type TraceSummary = z.infer<typeof traceSummarySchema>;

/** The id of a trace, whichever way this response chose to spell it. */
export const extractTraceId = (trace: TraceSummary): string | undefined =>
  trace.trace_id ?? trace.traceId;

/** `trace search` / `trace export` — the traces card. */
const tracesCardSchemaDefinition = z.looseObject({
  // A reduced result may carry an in-band "… N more truncated" string element;
  // tolerated here, skipped by readers (see `rowOrTruncationMarker`).
  traces: z.array(rowOrTruncationMarker(traceSummarySchema)),
  pagination: hitsPaginationSchema.optional(),
});
export interface TracesCardSchema extends Named<typeof tracesCardSchemaDefinition> {}
export const tracesCardSchema: TracesCardSchema = tracesCardSchemaDefinition;

/** `trace get` — one trace, in full. */
export const traceCardSchema = traceSummarySchema;

/** `dataset list`, `dataset records list` — the dataset card. */
const datasetCardSchemaDefinition = z.union([
  collectionSchema({
    key: "data",
    row: z.looseObject({
      id: z.string().optional(),
      name: z.string().optional(),
      slug: z.string().optional(),
      recordCount: z.number().optional(),
      updatedAt: z.union([z.string(), z.number()]).optional(),
    }),
  }),
  collectionSchema({ key: "records", row: z.looseObject({}) }),
]);
export interface DatasetCardSchema extends Named<typeof datasetCardSchemaDefinition> {}
export const datasetCardSchema: DatasetCardSchema = datasetCardSchemaDefinition;

/** `analytics query` — the metrics card, whose numbers roll up. */
const metricsCardSchemaDefinition = z.looseObject({
  // The canonical CLI timeseries response. Requiring the discriminating key is
  // intentional: `{ value: "a previous tool result" }` must never become an
  // Analytics card merely because this schema tolerated every object.
  currentPeriod: z.array(z.looseObject({})),
  previousPeriod: z.array(z.looseObject({})).optional(),
});
export interface MetricsCardSchema extends Named<typeof metricsCardSchemaDefinition> {}
export const metricsCardSchema: MetricsCardSchema = metricsCardSchemaDefinition;

/*
 * ── THE SHARED SHAPE VOCABULARY ──────────────────────────────────────────
 * The pieces both channels are built from: a field map (`…Fields`) is spread
 * into whichever object mode the channel needs; a leaf schema is used as-is.
 */

/** How to format values. Drives the axis, the tooltip and the comparison. */
export const timeseriesUnitSchema = z.enum(["usd", "count", "ms", "percent", "tokens"]);

/** One plotted point: x (ISO date, bucket label, or epoch) and value. */
export const timeseriesPointFields = {
  /** ISO date or bucket label — whatever the x axis should read. */
  t: z.union([z.string(), z.number()]),
  v: z.number(),
} as const;

/** The headline a plot supports: a value, its baseline, and their names. */
export const timeseriesComparisonFields = {
  label: z.string(),
  value: z.number(),
  baselineLabel: z.string(),
  baseline: z.number(),
} as const;

/** A table cell is a JSON primitive — never a nested structure to render. */
const tableCellSchemaDefinition = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export interface TableCellSchema extends Named<typeof tableCellSchemaDefinition> {}
export const tableCellSchema: TableCellSchema = tableCellSchemaDefinition;

/**
 * `table` — named columns, rows of primitive cells. Row length is
 * deliberately not pinned to the column count: a ragged row renders short
 * rather than failing the whole card.
 */
export const tableCardFields = {
  title: z.string().optional(),
  columns: z.array(z.string().min(1)).min(1),
  rows: z.array(z.array(tableCellSchema)),
} as const;

/** `stats` — labelled key-value figures ("p95 latency: 812ms"). */
export const statsCardFields = {
  title: z.string().optional(),
  items: z
    .array(
      z.object({
        label: z.string().min(1),
        value: z.union([z.string(), z.number()]),
        unit: z.string().optional(),
      }),
    )
    .min(1),
} as const;

/**
 * `choices` — a question with grounded options (ADR-060 §6). An option may
 * ground itself in a real entity via `ref`, hydrated as the VIEWER through
 * the id-reference seam: a dead ref renders disabled, a live one current.
 */
export const choicesCardFields = {
  question: z.string().min(1),
  options: z
    .array(
      z.object({
        id: z.string().min(1),
        label: z.string().min(1),
        description: z.string().optional(),
        /**
         * A quiet option is the way out, not the way forward: it renders as
         * an underlined link under the bordered rows and answers like any
         * other option ("I'd rather describe it", "Chat about this").
         */
        quiet: z.boolean().optional(),
        ref: z
          .object({
            type: z.string().min(1),
            id: z.string().min(1),
          })
          .optional(),
      }),
    )
    .min(1),
  multiSelect: z.boolean().optional(),
  allowOther: z.boolean().optional(),
  /**
   * The question is drawn as ordinary reply prose above the options, not as
   * a title: the ask is the whole of what Langy says, so its words live here
   * and the card carries them in the reply's own typography.
   */
  bare: z.boolean().optional(),
} as const;

/**
 * Plotted timeseries: named series over time with optional comparison. Not
 * derived from payload shape—the command that knows the question shapes this
 * payload (see `timeseriesShape.ts` in CLI and `timeseriesProbeSchema`).
 */
const timeseriesCardSchemaDefinition = z.looseObject({
  series: z
    .array(
      z.looseObject({
        name: z.string(),
        points: z.array(z.looseObject(timeseriesPointFields)),
      }),
    )
    .min(1),
  title: z.string().optional(),
  unit: timeseriesUnitSchema.optional(),
  comparison: z.looseObject(timeseriesComparisonFields).optional(),
  /** A `CustomGraphInput`, when the agent has one worth saving. */
  graph: z.unknown().optional(),
});
export interface TimeseriesCardSchema extends Named<typeof timeseriesCardSchemaDefinition> {}
export const timeseriesCardSchema: TimeseriesCardSchema = timeseriesCardSchemaDefinition;

/**
 * Evidence of timeseries: named series with ≥2 points (one reading is not a
 * trend). See `spendProbeSchema` for why probe ≠ acceptance schema.
 */
const timeseriesProbeSchemaDefinition = z.looseObject({
  series: z
    .array(
      z.looseObject({
        name: z.string(),
        points: z.array(z.looseObject(timeseriesPointFields)).min(2),
      }),
    )
    .min(1),
});
export interface TimeseriesProbeSchema extends Named<typeof timeseriesProbeSchemaDefinition> {}
export const timeseriesProbeSchema: TimeseriesProbeSchema = timeseriesProbeSchemaDefinition;

/** `experiment run|results`, `scenario run`, `suite run`, `agent run` — a run card. */
const evalRunCardSchemaDefinition = z.looseObject({
  id: z.string().optional(),
  runId: z.string().optional(),
  status: z.string().optional(),
  passed: z.number().optional(),
  failed: z.number().optional(),
  total: z.number().optional(),
  results: z.unknown().optional(),
});
export interface EvalRunCardSchema extends Named<typeof evalRunCardSchemaDefinition> {}
export const evalRunCardSchema: EvalRunCardSchema = evalRunCardSchemaDefinition;

/** `scenario list|get` — a scenario card. */
const scenarioCardSchemaDefinition = z.looseObject({
  id: z.string().optional(),
  name: z.string().optional(),
  status: z.string().optional(),
});
export interface ScenarioCardSchema extends Named<typeof scenarioCardSchemaDefinition> {}
export const scenarioCardSchema: ScenarioCardSchema = scenarioCardSchemaDefinition;

/** `prompt push|sync` — the diff card. */
const promptDiffCardSchemaDefinition = z.looseObject({
  name: z.string().optional(),
  version: z.union([z.string(), z.number()]).optional(),
  changes: z.unknown().optional(),
});
export interface PromptDiffCardSchema extends Named<typeof promptDiffCardSchemaDefinition> {}
export const promptDiffCardSchema: PromptDiffCardSchema = promptDiffCardSchemaDefinition;

/**
 * The generic read: a collection under whichever key this endpoint chose, or a
 * single resource. This is what the long tail of `list`/`get` commands renders
 * as, and the reason the contract does not need ninety schemas.
 */
const resourceCardSchemaDefinition = z.union([
  z.array(z.unknown()),
  z.looseObject({
    data: z.array(z.unknown()).optional(),
    items: z.array(z.unknown()).optional(),
    results: z.array(z.unknown()).optional(),
    records: z.array(z.unknown()).optional(),
    pagination: paginationSchema.optional(),
  }),
]);
export interface ResourceCardSchema extends Named<typeof resourceCardSchemaDefinition> {}
export const resourceCardSchema: ResourceCardSchema = resourceCardSchemaDefinition;

/**
 * Keys whose value NAMES a resource. An id under any of the spellings the
 * platform uses, or the human name a card would title itself with.
 */
const RESOURCE_NAME_KEYS = ["id", "slug", "name", "title", "key", "handle"];

/** Keys an endpoint may return its rows under. Mirrors the digest's list. */
const RESOURCE_COLLECTION_KEYS = ["traces", "data", "items", "results", "records"];

const isNamedValue = (value: unknown): boolean =>
  (typeof value === "string" && value.trim().length > 0) ||
  (typeof value === "number" && Number.isFinite(value));

/**
 * Guards create results: must return id, name, or rows. Local file scaffolds
 * (file:...) only pass on server-minted ids, not names alone.
 */
export const namesCreatedResource = (payload: unknown): boolean => {
  if (Array.isArray(payload)) return payload.length > 0;
  if (!payload || typeof payload !== "object") return false;

  const record = payload as Record<string, unknown>;
  const isLocalFileScaffold =
    typeof record.dependency === "string" && record.dependency.startsWith("file:");

  return Object.entries(record).some(([key, value]) =>
    entryNamesResource({ key, value, isLocalFileScaffold }),
  );
};

const entryNamesResource = ({
  key,
  value,
  isLocalFileScaffold,
}: {
  key: string;
  value: unknown;
  isLocalFileScaffold: boolean;
}): boolean => {
  if (/(^|_)id$|Id$/.test(key) && isNamedValue(value)) return true;
  if (isLocalFileScaffold) return false;
  if (RESOURCE_NAME_KEYS.includes(key) && isNamedValue(value)) return true;
  return RESOURCE_COLLECTION_KEYS.includes(key) && Array.isArray(value) && value.length > 0;
};

/**
 * `<resource> create` — the card that says a NEW thing exists. Strictly
 * narrower than {@link resourceCardSchema} on purpose: a payload naming
 * nothing must not parse as one, or the panel manufactures success from `[]`.
 */
const createdResourceCardSchemaDefinition = resourceCardSchema.refine(namesCreatedResource, {
  message: "a created-resource result must name the resource it created",
});
export interface CreatedResourceCardSchema extends Named<
  typeof createdResourceCardSchemaDefinition
> {}
export const createdResourceCardSchema: CreatedResourceCardSchema =
  createdResourceCardSchemaDefinition;

/**
 * Spend card: cost is a dimension on keys, budgets, traces, filtered sets.
 * Discriminator is a named cost field (not just "has numbers").
 */
export const spendCardSchema = resourceCardSchema;

/**
 * Probe (evidence) ≠ acceptance: acceptance permissive (floor), probe strict
 * (bar). See `spendCardSchema` for permissive version.
 */
const spendProbeSchemaDefinition = z.union([
  // A rolled-up total, however this endpoint spells it.
  z.looseObject({ totalCost: z.number() }),
  z.looseObject({ total_cost: z.number() }),
  // Rows that each carry a cost — a trace page, a per-key spend breakdown.
  z.looseObject({
    traces: z.array(z.looseObject({ metrics: z.looseObject({ total_cost: z.number() }) })),
  }),
]);
export interface SpendProbeSchema extends Named<typeof spendProbeSchemaDefinition> {}
export const spendProbeSchema: SpendProbeSchema = spendProbeSchemaDefinition;

/**
 * `evaluator get`, `monitor get` — the config card, discriminated on an
 * explicit enabled/type flag (what it checks, whether it's on) rather than
 * a bare `{ name }`, which is every resource in the product.
 */
export const evaluatorConfigCardSchema = resourceCardSchema;

/** The evidence a payload is an evaluator's config — see `spendProbeSchema`. */
const evaluatorConfigProbeSchemaDefinition = z.union([
  z.looseObject({ enabled: z.boolean() }),
  z.looseObject({ evaluatorType: z.string() }),
  z.looseObject({ evaluator_type: z.string() }),
]);
export interface EvaluatorConfigProbeSchema extends Named<
  typeof evaluatorConfigProbeSchemaDefinition
> {}
export const evaluatorConfigProbeSchema: EvaluatorConfigProbeSchema =
  evaluatorConfigProbeSchemaDefinition;

/**
 * `dashboard get`, `graph get` — the one resource that genuinely IS a visual,
 * discriminated on carrying graph/panel definitions rather than on the noun,
 * so a dashboard payload renders as one wherever it came from.
 */
export const dashboardCardSchema = resourceCardSchema;

/** The evidence a payload is a dashboard/graph — see `spendProbeSchema`. */
const dashboardProbeSchemaDefinition = z.union([
  z.looseObject({ graphs: z.array(z.looseObject({})) }),
  z.looseObject({ panels: z.array(z.looseObject({})) }),
  z.looseObject({ graphType: z.string() }),
]);
export interface DashboardProbeSchema extends Named<typeof dashboardProbeSchemaDefinition> {}
export const dashboardProbeSchema: DashboardProbeSchema = dashboardProbeSchemaDefinition;

/**
 * Every card the panel can draw, whichever channel wrote it. ONE list, so the
 * measured and derived channels cannot grow separate vocabularies. Both are
 * SUBSETS of this ({@link MEASURED_CARD_KINDS}, `derived-safe.ts`'s allowlist).
 */
export const CARD_KINDS = [
  "traces",
  "trace",
  "metrics",
  "timeseries",
  "evalRun",
  "dataset",
  "scenario",
  "promptDiff",
  "spend",
  "evaluatorConfig",
  "dashboard",
  "resourceRead",
  "resourceCreated",
  "resourceUpdated",
  "resourceRemoved",
  "table",
  "stats",
  "choices",
] as const;

export type CardKind = (typeof CARD_KINDS)[number];

/**
 * Security-relevant classification: resource (asserts records exist—measured
 * only) vs presentation (presents handed values—either channel). Exhaustive via
 * `satisfies Record<CardKind, CardShape>`. See `derived-safe.ts` gate.
 */
export type CardShape = "resource" | "presentation";

export const CARD_SHAPE = {
  traces: "resource",
  trace: "resource",
  metrics: "resource",
  evalRun: "resource",
  dataset: "resource",
  scenario: "resource",
  promptDiff: "resource",
  spend: "resource",
  evaluatorConfig: "resource",
  dashboard: "resource",
  resourceRead: "resource",
  resourceCreated: "resource",
  resourceUpdated: "resource",
  resourceRemoved: "resource",
  // `timeseries` is presentation-shaped even though a command produces it:
  // the card draws the points it is given and asserts nothing about what was
  // searched. That is exactly why a model may draw one (ADR-060 §4) while the
  // chrome, not the shape, says who computed it.
  timeseries: "presentation",
  table: "presentation",
  stats: "presentation",
  choices: "presentation",
} as const satisfies Record<CardKind, CardShape>;

/**
 * The kinds a MEASURED result can be stamped with — the cards a CLI command
 * produces. `table`, `stats` and `choices` are absent because no command emits
 * one; they reach the panel through the derived channel only.
 */
export const MEASURED_CARD_KINDS = [
  "traces",
  "trace",
  "metrics",
  "timeseries",
  "evalRun",
  "dataset",
  "scenario",
  "promptDiff",
  "spend",
  "evaluatorConfig",
  "dashboard",
  "resourceRead",
  "resourceCreated",
  "resourceUpdated",
  "resourceRemoved",
] as const satisfies readonly CardKind[];

export type MeasuredCardKind = (typeof MEASURED_CARD_KINDS)[number];

/** The schema that reads each measured card's payload. */
export const SCHEMA_BY_CARD_KIND: Record<MeasuredCardKind, z.ZodType> = {
  traces: tracesCardSchema,
  trace: traceCardSchema,
  metrics: metricsCardSchema,
  timeseries: timeseriesCardSchema,
  evalRun: evalRunCardSchema,
  dataset: datasetCardSchema,
  scenario: scenarioCardSchema,
  promptDiff: promptDiffCardSchema,
  spend: spendCardSchema,
  evaluatorConfig: evaluatorConfigCardSchema,
  dashboard: dashboardCardSchema,
  resourceRead: resourceCardSchema,
  // Narrower than the rest by design — see `createdResourceCardSchema`. A
  // create that named nothing must not READ as a created-resource document,
  // whichever consumer asks.
  resourceCreated: createdResourceCardSchema,
  resourceUpdated: resourceCardSchema,
  resourceRemoved: resourceCardSchema,
};
