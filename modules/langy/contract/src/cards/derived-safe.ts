import type { Named } from "@langwatch/module";
/**
 * The DERIVED-SAFE allowlist (ADR-060 §3-§6): shared card kinds Langy may
 * write, and their strict schemas. Closed list; widening is gated at compile
 * time and pinned by `derived-safe.unit.test.ts`.
 */
import * as z from "zod";

import {
  type CARD_SHAPE,
  choicesCardFields,
  statsCardFields,
  tableCardFields,
  timeseriesComparisonFields,
  timeseriesPointFields,
  timeseriesUnitSchema,
  type CardKind,
} from "./schemas.ts";

/**
 * The kinds that present values they were handed, rather than asserting that
 * records exist — computed from `CARD_SHAPE`, never restated. Gate 2 (type-only).
 */
export type PresentationCardKind = {
  [K in CardKind]: (typeof CARD_SHAPE)[K] extends "presentation" ? K : never;
}[CardKind];

/**
 * Every kind a MODEL-EMITTED card may claim. Closed subset of `CARD_KINDS`;
 * `choices` excluded — the model asks via its `question` tool, not a fence.
 */
export const DERIVED_SAFE_CARD_KINDS = [
  "timeseries",
  "table",
  "stats",
] as const satisfies readonly PresentationCardKind[];

export type DerivedSafeCardKind = (typeof DERIVED_SAFE_CARD_KINDS)[number];

/**
 * Every kind a stamped `langy-card` PART may carry: model-emittable kinds plus
 * `choices` (panel-stamped). Wider than the fence allowlist on purpose — two
 * producers vs one.
 */
export const RENDERED_CARD_KINDS = [
  ...DERIVED_SAFE_CARD_KINDS,
  "choices",
] as const satisfies readonly PresentationCardKind[];

export type RenderedCardKind = (typeof RENDERED_CARD_KINDS)[number];

/**
 * Affordance HINTS (ADR-060 §5) — closed vocabulary, never a URL/action/
 * component. `explore`: a Trace Explorer query, rendered only if it validates.
 * `verify`: run the data as a real analytics query (derived-vs-measured bridge).
 */
const langyCardHintSchemaDefinition = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("explore"),
    query: z.record(z.string(), z.unknown()),
  }),
  z.object({
    type: z.literal("verify"),
    query: z.record(z.string(), z.unknown()).optional(),
  }),
]);
export interface LangyCardHintSchema extends Named<typeof langyCardHintSchemaDefinition> {}
export const langyCardHintSchema: LangyCardHintSchema = langyCardHintSchemaDefinition;
export type LangyCardHint = z.infer<typeof langyCardHintSchema>;

/**
 * Fields every derived card carries. `blockId` is the card's identity
 * downstream (stamped part, preview reconciliation, choices selection
 * binding). Required — missing it fails validation.
 */
const derivedCardBase = {
  blockId: z.string().min(1),
  hints: z.array(langyCardHintSchema).optional(),
} as const;

/**
 * `timeseries` — one or more named series over an ordered axis. Shares the
 * measured schema's field names (same chart body); differs only in
 * tolerance: strict objects, non-empty series.
 */
const langyDerivedTimeseriesCardSchemaDefinition = z.object({
  ...derivedCardBase,
  kind: z.literal("timeseries"),
  title: z.string().optional(),
  unit: timeseriesUnitSchema.optional(),
  series: z
    .array(
      z.object({
        name: z.string().min(1),
        points: z.array(z.object(timeseriesPointFields)).min(1),
      }),
    )
    .min(1),
  comparison: z.object(timeseriesComparisonFields).optional(),
});
export interface LangyDerivedTimeseriesCardSchema extends Named<
  typeof langyDerivedTimeseriesCardSchemaDefinition
> {}
export const langyDerivedTimeseriesCardSchema: LangyDerivedTimeseriesCardSchema =
  langyDerivedTimeseriesCardSchemaDefinition;
export type LangyDerivedTimeseriesCard = z.infer<typeof langyDerivedTimeseriesCardSchema>;

/** `table` — a generic derived table: named columns, rows of primitive cells. */
const langyDerivedTableCardSchemaDefinition = z.object({
  ...derivedCardBase,
  kind: z.literal("table"),
  ...tableCardFields,
});
export interface LangyDerivedTableCardSchema extends Named<
  typeof langyDerivedTableCardSchemaDefinition
> {}
export const langyDerivedTableCardSchema: LangyDerivedTableCardSchema =
  langyDerivedTableCardSchemaDefinition;
export type LangyDerivedTableCard = z.infer<typeof langyDerivedTableCardSchema>;

/** `stats` — labelled key-value figures ("p95 latency: 812ms"). */
const langyDerivedStatsCardSchemaDefinition = z.object({
  ...derivedCardBase,
  kind: z.literal("stats"),
  ...statsCardFields,
});
export interface LangyDerivedStatsCardSchema extends Named<
  typeof langyDerivedStatsCardSchemaDefinition
> {}
export const langyDerivedStatsCardSchema: LangyDerivedStatsCardSchema =
  langyDerivedStatsCardSchemaDefinition;
export type LangyDerivedStatsCard = z.infer<typeof langyDerivedStatsCardSchema>;

/**
 * `choices` — the one sanctioned way to offer options (ADR-060 §6), panel-
 * stamped from a `question` tool call. Option ids must be unique — selection
 * binds by `{blockId, optionId}`.
 */
const choicesCardObjectSchema = z.object({
  ...derivedCardBase,
  kind: z.literal("choices"),
  ...choicesCardFields,
});

/** Reject duplicated option ids — shared by the union and the direct schema. */
function refineUniqueOptionIds(
  card: z.infer<typeof choicesCardObjectSchema>,
  ctx: z.RefinementCtx,
): void {
  const seen = new Set<string>();
  for (const option of card.options) {
    if (seen.has(option.id)) {
      ctx.addIssue({
        code: "custom",
        message: `duplicate option id "${option.id}"`,
        path: ["options"],
      });
      return;
    }
    seen.add(option.id);
  }
}

const langyDerivedChoicesCardSchemaDefinition =
  choicesCardObjectSchema.superRefine(refineUniqueOptionIds);
export interface LangyDerivedChoicesCardSchema extends Named<
  typeof langyDerivedChoicesCardSchemaDefinition
> {}
export const langyDerivedChoicesCardSchema: LangyDerivedChoicesCardSchema =
  langyDerivedChoicesCardSchemaDefinition;
export type LangyDerivedChoicesCard = z.infer<typeof choicesCardObjectSchema>;

/**
 * The strict schema per rendered kind — gate 3: `Record<RenderedCardKind, …>`
 * forces a new kind to arrive with a schema. Both unions below assemble from
 * this map so they cannot drift apart.
 */
const DERIVED_SCHEMA_BY_KIND = {
  timeseries: langyDerivedTimeseriesCardSchema,
  table: langyDerivedTableCardSchema,
  stats: langyDerivedStatsCardSchema,
  choices: choicesCardObjectSchema,
} as const satisfies Record<RenderedCardKind, z.ZodObject>;

/**
 * The FENCE channel: a model-emitted card is exactly one of the allowlisted
 * kinds — the allowlist IS the schema, not a filter in front of it.
 */
const langyModelEmittedCardSchemaDefinition = z.discriminatedUnion("kind", [
  DERIVED_SCHEMA_BY_KIND.timeseries,
  DERIVED_SCHEMA_BY_KIND.table,
  DERIVED_SCHEMA_BY_KIND.stats,
]);
export interface LangyModelEmittedCardSchema extends Named<
  typeof langyModelEmittedCardSchemaDefinition
> {}
export const langyModelEmittedCardSchema: LangyModelEmittedCardSchema =
  langyModelEmittedCardSchemaDefinition;
export type LangyModelEmittedCard = z.infer<typeof langyModelEmittedCardSchema>;

/**
 * The PART channel: every kind a stamped card part may carry, so the panel's
 * own `choices` card validates through the same module the relay stamps with.
 */
const langyDerivedCardSchemaDefinition = z
  .discriminatedUnion("kind", [
    DERIVED_SCHEMA_BY_KIND.timeseries,
    DERIVED_SCHEMA_BY_KIND.table,
    DERIVED_SCHEMA_BY_KIND.stats,
    DERIVED_SCHEMA_BY_KIND.choices,
  ])
  .superRefine((card, ctx) => {
    if (card.kind === "choices") refineUniqueOptionIds(card, ctx);
  });
export interface LangyDerivedCardSchema extends Named<typeof langyDerivedCardSchemaDefinition> {}
export const langyDerivedCardSchema: LangyDerivedCardSchema = langyDerivedCardSchemaDefinition;
export type LangyDerivedCard = z.infer<typeof langyDerivedCardSchema>;

/**
 * Is this kind model-emittable? The runtime reading of the allowlist, for the
 * places that hold a `CardKind` rather than a literal.
 */
export const isDerivedSafeCardKind = (kind: CardKind): kind is DerivedSafeCardKind =>
  (DERIVED_SAFE_CARD_KINDS as readonly CardKind[]).includes(kind);
