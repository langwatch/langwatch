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
  traces: z.array(traceSummarySchema),
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
  // Analytics answers in several shapes depending on the query; the card only
  // needs "some named numbers", so that is all this insists on.
  result: z.unknown().optional(),
  data: z.unknown().optional(),
  series: z.unknown().optional(),
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

/** Every card the panel can draw. Mirrors the app's `CapabilityRenderKind`. */
export const CARD_KINDS = [
  "traces",
  "trace",
  "metrics",
  "evalRun",
  "dataset",
  "scenario",
  "promptDiff",
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
  evalRun: evalRunCardSchema,
  dataset: datasetCardSchema,
  scenario: scenarioCardSchema,
  promptDiff: promptDiffCardSchema,
  resourceRead: resourceCardSchema,
  resourceCreated: resourceCardSchema,
  resourceUpdated: resourceCardSchema,
  resourceRemoved: resourceCardSchema,
};
