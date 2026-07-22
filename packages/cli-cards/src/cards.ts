/**
 * The card schemas: what each kind of LangWatch CLI result looks like once it has
 * been read as structure rather than as text.
 *
 * There is one schema per CARD, not one per command — because the panel has one
 * card per shape, and ~90 CLI commands collapse into a handful of shapes. A
 * `dataset list` and an `evaluator list` are the same card with different nouns;
 * pretending otherwise would mean ninety schemas that drift ninety ways. The long
 * tail therefore lands on the generic resource cards, which is the reuse that
 * makes this contract maintainable rather than a second copy of the API.
 *
 * Every schema is deliberately permissive about fields it does not name: a card
 * needs a handful of fields to draw a row, and the agent reading the same JSON
 * needs everything else. Parsing must never be lossy, and a CLI that grows a
 * field must never break a card.
 */
import * as z from "zod/v4";
import {
  collectionSchema,
  hitsPaginationSchema,
  paginationSchema,
  rowOrTruncationMarker,
  textValueSchema,
} from "./primitives.js";

/**
 * One trace, as the traces API spells it — which is, unhelpfully, two ways at
 * once: `trace_id` on the raw search document, `traceId` on some serialisers.
 * Both are accepted and neither is invented.
 */
export const traceSummarySchema = z.looseObject({
  trace_id: z.string().optional(),
  traceId: z.string().optional(),
  input: textValueSchema.optional(),
  output: textValueSchema.optional(),
  timestamps: z
    .looseObject({ started_at: z.number().optional() })
    .optional(),
  error: z.unknown().optional(),
});

export type TraceSummary = z.infer<typeof traceSummarySchema>;

/** The id of a trace, whichever way this response chose to spell it. */
export const traceIdOf = (trace: TraceSummary): string | undefined =>
  trace.trace_id ?? trace.traceId;

/** `trace search` / `trace export` — the traces card. */
export const tracesCardSchema = z.looseObject({
  // A reduced result may carry an in-band "… N more truncated" string element;
  // tolerated here, skipped by readers (see `rowOrTruncationMarker`).
  traces: z.array(rowOrTruncationMarker(traceSummarySchema)),
  pagination: hitsPaginationSchema.optional(),
});

/** `trace get` — one trace, in full. */
export const traceCardSchema = traceSummarySchema;

/** `dataset list`, `dataset records list` — the dataset card. */
export const datasetCardSchema = z.union([
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

/** `analytics query` — the metrics card, whose numbers roll up. */
export const metricsCardSchema = z.looseObject({
  // The canonical CLI timeseries response. Requiring the discriminating key is
  // intentional: `{ value: "a previous tool result" }` must never become an
  // Analytics card merely because this schema tolerated every object.
  currentPeriod: z.array(z.looseObject({})),
  previousPeriod: z.array(z.looseObject({})).optional(),
});

/**
 * A plotted answer: one or more named series over time, optionally with a
 * period-over-period comparison.
 *
 * The card the panel had no way to draw. "Compare trace cost this week to last"
 * is two numbers and a direction, which the metrics card renders as two large
 * decimals — technically the answer, and useless for the question actually
 * asked, which is about a TREND. A trend needs a shape.
 *
 * Deliberately NOT derived from a tool payload by sniffing it. The platform
 * returns traces, spans and buckets; which of their fields is worth plotting,
 * against what baseline, and what the axis means are judgements about the
 * QUESTION, not facts about the response. So the COMMAND that knows the
 * question shapes this payload — `analytics query` knows the metric, the
 * aggregation and the window it was asked for, and emits `series` itself (see
 * `timeseriesShape.ts` in the CLI) — and the registry only recognises the
 * shape once it is there (`timeseriesProbeSchema`).
 *
 * ADR-059 §5 also sketches a `langwatch present` command for an agent to emit
 * a card directly. That command does not exist; nothing emits this card except
 * a command that shaped its own answer.
 *
 * `graph` is an opaque passthrough: when the agent supplies a graph definition
 * the card can offer to save it to a dashboard, and when it does not the card
 * still draws, minus that action. The panel never invents one.
 */
export const timeseriesCardSchema = z.looseObject({
  series: z
    .array(
      z.looseObject({
        name: z.string(),
        points: z.array(
          z.looseObject({
            /** ISO date or bucket label — whatever the x axis should read. */
            t: z.union([z.string(), z.number()]),
            v: z.number(),
          }),
        ),
      }),
    )
    .min(1),
  title: z.string().optional(),
  /** How to format values. Drives the axis, the tooltip and the comparison. */
  unit: z.enum(["usd", "count", "ms", "percent", "tokens"]).optional(),
  /** The headline the plot supports: a value, its baseline, and their names. */
  comparison: z
    .looseObject({
      label: z.string(),
      value: z.number(),
      baselineLabel: z.string(),
      baseline: z.number(),
    })
    .optional(),
  /** A `CustomGraphInput`, when the agent has one worth saving. */
  graph: z.unknown().optional(),
});

/**
 * The EVIDENCE that a payload is a timeseries — see `spendProbeSchema` for why
 * this is not the card's acceptance schema.
 *
 * The bar is TWO points in a named series. Two, because one point is a reading
 * and not a trend, and an axis drawn under a single value dresses it up as a
 * shape. Named, because an unnamed array of `{t, v}` is a shape half the
 * product could produce by accident, and this probe outranks spend — it has to
 * earn that.
 */
export const timeseriesProbeSchema = z.looseObject({
  series: z
    .array(
      z.looseObject({
        name: z.string(),
        points: z
          .array(z.looseObject({ t: z.union([z.string(), z.number()]), v: z.number() }))
          .min(2),
      }),
    )
    .min(1),
});

/** `experiment run|results`, `scenario run`, `suite run`, `agent run` — a run card. */
export const evalRunCardSchema = z.looseObject({
  id: z.string().optional(),
  runId: z.string().optional(),
  status: z.string().optional(),
  passed: z.number().optional(),
  failed: z.number().optional(),
  total: z.number().optional(),
  results: z.unknown().optional(),
});

/** `scenario list|get` — a scenario card. */
export const scenarioCardSchema = z.looseObject({
  id: z.string().optional(),
  name: z.string().optional(),
  status: z.string().optional(),
});

/** `prompt push|sync` — the diff card. */
export const promptDiffCardSchema = z.looseObject({
  name: z.string().optional(),
  version: z.union([z.string(), z.number()]).optional(),
  changes: z.unknown().optional(),
});

/**
 * The generic read: a collection under whichever key this endpoint chose, or a
 * single resource. This is what the long tail of `list`/`get` commands renders
 * as, and the reason the contract does not need ninety schemas.
 */
export const resourceCardSchema = z.union([
  z.array(z.unknown()),
  z.looseObject({
    data: z.array(z.unknown()).optional(),
    items: z.array(z.unknown()).optional(),
    results: z.array(z.unknown()).optional(),
    records: z.array(z.unknown()).optional(),
    pagination: paginationSchema.optional(),
  }),
]);

/**
 * Keys whose value NAMES a resource. An id under any of the spellings the
 * platform uses, or the human name a card would title itself with.
 */
const RESOURCE_NAME_KEYS = ["id", "slug", "name", "title", "key", "handle"];

/** Keys an endpoint may return its rows under. Mirrors the digest's list. */
const RESOURCE_COLLECTION_KEYS = [
  "traces",
  "data",
  "items",
  "results",
  "records",
];

const isNamedValue = (value: unknown): boolean =>
  (typeof value === "string" && value.trim().length > 0) ||
  (typeof value === "number" && Number.isFinite(value));

/**
 * Does this payload NAME something that now exists?
 *
 * The question a `create` card's copy stakes everything on. "Created and ready
 * to use", with a link through to the thing, is a claim about the world; a
 * result carrying no id, no name and no rows cannot support it. A create that
 * never happened — refused upstream, or re-run without its arguments — returns
 * exactly that nothing, and the card used to render the claim anyway, complete
 * with a deep link to a resource that was never made.
 *
 * Deliberately asked of CREATES only. An update or a delete is named by the
 * command's own arguments, so an empty 200 body is a normal, honest "done";
 * a create's identity can only come back from the server, so its absence is
 * the whole story.
 *
 * Evidence, not vibes: an id/name, or a non-empty collection of rows. A bare
 * `{ ok: true }` names nothing and does not pass — the card would have nothing
 * to title itself with or link to, which is precisely the state this guards.
 */
export const namesCreatedResource = (payload: unknown): boolean => {
  if (Array.isArray(payload)) return payload.length > 0;
  if (!payload || typeof payload !== "object") return false;

  const record = payload as Record<string, unknown>;
  for (const [key, value] of Object.entries(record)) {
    if (RESOURCE_NAME_KEYS.includes(key) && isNamedValue(value)) return true;
    if (/(^|_)id$|Id$/.test(key) && isNamedValue(value)) return true;
    if (RESOURCE_COLLECTION_KEYS.includes(key) && Array.isArray(value) && value.length > 0) {
      return true;
    }
  }
  return false;
};

/**
 * `<resource> create` — the card that says a NEW thing exists.
 *
 * Strictly narrower than {@link resourceCardSchema} on purpose: this is the one
 * write card whose copy asserts a fact the payload has to substantiate, so a
 * payload that names nothing must not parse as one. The panel then renders the
 * outcome as unconfirmed instead of manufacturing a success out of `[]`.
 */
export const createdResourceCardSchema = resourceCardSchema.refine(
  namesCreatedResource,
  { message: "a created-resource result must name the resource it created" },
);

/**
 * `virtual-keys get|list`, `gateway-budgets list`, and ANY result whose rows
 * carry cost — the spend card.
 *
 * Cost is a DIMENSION, not a resource: it lives on a virtual key, on a budget,
 * on one trace and on a whole filtered set of them. A card keyed only to the
 * resources named "spend-ish" would catch the first two and miss the two users
 * actually ask about, which is why this one is reached by shape as well as name.
 *
 * The discriminator is a NAMED cost field. "Has numbers" would promote every
 * list in the product.
 */
export const spendCardSchema = resourceCardSchema;

/**
 * The EVIDENCE that a payload is about spend — strictly narrower than what the
 * card can draw.
 *
 * These two must not be the same schema, and conflating them is a real bug I
 * shipped once: a card's ACCEPTANCE schema says "I can render this", and must be
 * permissive or a deliberate `byVerb` binding breaks the moment a real payload
 * omits a field. A card's PROBE says "this payload proves it is mine", and must
 * be strict or it promotes everything. Acceptance is a floor; evidence is a bar.
 */
export const spendProbeSchema = z.union([
  // A rolled-up total, however this endpoint spells it.
  z.looseObject({ totalCost: z.number() }),
  z.looseObject({ total_cost: z.number() }),
  // Rows that each carry a cost — a trace page, a per-key spend breakdown.
  z.looseObject({
    traces: z.array(
      z.looseObject({ metrics: z.looseObject({ total_cost: z.number() }) }),
    ),
  }),
]);

/**
 * `evaluator get`, `monitor get` — the config card.
 *
 * What a user asks about an evaluator is what it checks and whether it is on, so
 * the discriminator is an explicit enabled/type flag. A bare `{ name }` is every
 * resource in the product and must never land here.
 */
export const evaluatorConfigCardSchema = resourceCardSchema;

/** The evidence a payload is an evaluator's config — see `spendProbeSchema`. */
export const evaluatorConfigProbeSchema = z.union([
  z.looseObject({ enabled: z.boolean() }),
  z.looseObject({ evaluatorType: z.string() }),
  z.looseObject({ evaluator_type: z.string() }),
]);

/**
 * `dashboard get`, `graph get` — the one resource that genuinely IS a visual.
 *
 * Discriminated on carrying graph/panel definitions rather than on the noun, so
 * a dashboard payload renders as one wherever it came from.
 */
export const dashboardCardSchema = resourceCardSchema;

/** The evidence a payload is a dashboard/graph — see `spendProbeSchema`. */
export const dashboardProbeSchema = z.union([
  z.looseObject({ graphs: z.array(z.looseObject({})) }),
  z.looseObject({ panels: z.array(z.looseObject({})) }),
  z.looseObject({ graphType: z.string() }),
]);

/** Every card the panel can draw. Mirrors the app's `CapabilityRenderKind`. */
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
] as const;

export type CardKind = (typeof CARD_KINDS)[number];

/** The schema that reads each card's payload. */
export const SCHEMA_BY_CARD_KIND: Record<CardKind, z.ZodType> = {
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
