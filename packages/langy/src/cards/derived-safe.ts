/**
 * The DERIVED-SAFE allowlist (ADR-060 §3) — which of the shared card kinds
 * Langy may write for itself, and the strict schemas a ```langy-card fence is
 * validated against.
 *
 * ── WHY AN ALLOWLIST AT ALL ────────────────────────────────────────────────
 *
 * A model that can emit a `traces` card can assert records that were never
 * searched for. The card would look exactly like a measured one, because it
 * IS the same card — that is the point of having one vocabulary. So the
 * defence cannot live in the rendering; it has to be at the boundary, and it
 * has to be a closed list rather than a filter in front of an open one: a
 * resource-shaped `kind` fails the discriminator and becomes a failed card,
 * never a guessed one.
 *
 * ── HOW WIDENING IS MADE HARD ──────────────────────────────────────────────
 *
 * There is now ONE kind list (`schemas.ts`), which means this allowlist is a
 * SUBSET SELECTOR over it — and a subset selector is exactly the kind of thing
 * that widens by accident when someone adds a kind upstream. Three gates stop
 * that, and none of them is a comment asking you to be careful:
 *
 *   1. AT THE CLASSIFICATION. `CARD_SHAPE` in `schemas.ts` is
 *      `satisfies Record<CardKind, CardShape>`, so a new kind does not
 *      typecheck until someone states whether it asserts records exist. The
 *      question cannot be skipped, because the build asks it.
 *   2. AT THIS LIST. {@link DERIVED_SAFE_CARD_KINDS} is
 *      `satisfies readonly PresentationCardKind[]` — a type computed FROM that
 *      classification. Naming a resource-shaped kind here is a type error on
 *      the line that names it. Widening therefore requires first re-classifying
 *      the kind as presentation, which is a one-word claim a reviewer can see
 *      and disbelieve, rather than an omission nobody notices.
 *   3. AT THE SCHEMA MAP. {@link DERIVED_SCHEMA_BY_KIND} is
 *      `Record<DerivedSafeCardKind, …>`, so a kind added to the list does not
 *      build until someone AUTHORS a strict schema for it. This module never
 *      reads `SCHEMA_BY_CARD_KIND`: the measured acceptance schemas are
 *      deliberately permissive (a card must not break when the CLI grows a
 *      field), and there must be no path by which a kind becomes
 *      model-emittable against a schema written to forgive.
 *
 * `derived-safe.unit.test.ts` pins all three at RUN time as well, walking the
 * whole shared kind list, so a cast or a `@ts-expect-error` cannot quietly buy
 * a resource-shaped kind a place on this channel.
 *
 * ── STRICT, BECAUSE SALVAGE IS NOT ─────────────────────────────────────────
 *
 * These schemas are the STRICT half of "transport-tolerant, boundary-strict":
 * salvage (`../inline-channel/salvage.ts`) repairs the JSON as aggressively as
 * engineering allows, and the repaired document must then pass one of these —
 * a payload that parses but does not validate is a failed card, never a
 * guessed one. Both the relay stamp and the client preview validate through
 * this one module, so the two runtimes cannot disagree about what a fence
 * means.
 *
 * The SHAPES come from `schemas.ts`, declared there once, so a derived chart
 * draws through the same widget vocabulary as a measured one — the chrome, not
 * the shape, is what tells them apart (ADR-060 §4). What this module adds is
 * the derived ENVELOPE and the tolerance: strict objects and non-empty bars,
 * because nothing here came back from the platform.
 *
 * NOTE ON `blockId`. The envelope's id field keeps its wire name. It is the
 * model-facing contract — AGENTS.md and the shipped skills tell the assistant
 * to emit `blockId`, and the stamped parts already in the event stream carry
 * it. Renaming it is a prompt-and-data change, not a type change, so it is not
 * bundled into this one.
 */
import * as z from "zod/v4";

import {
  CARD_SHAPE,
  choicesCardFields,
  statsCardFields,
  tableCardFields,
  timeseriesComparisonFields,
  timeseriesPointFields,
  timeseriesUnitSchema,
  type CardKind,
} from "./schemas.js";

/**
 * The kinds that present values they were handed, rather than asserting that
 * records exist — computed from `CARD_SHAPE`, never restated.
 *
 * This is gate 2. It is a TYPE, so it costs nothing at runtime and there is no
 * code path that can route around it.
 */
export type PresentationCardKind = {
  [K in CardKind]: (typeof CARD_SHAPE)[K] extends "presentation" ? K : never;
}[CardKind];

/**
 * Every kind a model-emitted card may claim. Closed by construction, and a
 * strict subset of `CARD_KINDS`.
 *
 * Deliberately NOT here: every resource-shaped kind (`traces`, `evalRun`,
 * `resourceCreated`, …). Adding one is a type error — see the header.
 */
export const DERIVED_SAFE_CARD_KINDS = [
  "timeseries",
  "table",
  "stats",
  "choices",
] as const satisfies readonly PresentationCardKind[];

export type DerivedSafeCardKind = (typeof DERIVED_SAFE_CARD_KINDS)[number];

/**
 * Affordance HINTS (ADR-060 §5) — requests from a closed vocabulary. A hint
 * never carries a URL, an action, or a component: the platform validates the
 * hinted query against its own seams at render time and binds the real
 * control, or silently drops the hint.
 *
 *   - `explore` — a Trace Explorer filter/query; rendered only if it
 *     validates against the real field catalogue.
 *   - `verify`  — the derived-vs-measured bridge: offer to run the data as a
 *     real analytics query; the measured result arrives as an ordinary
 *     measured card.
 */
export const langyCardHintSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("explore"),
    query: z.record(z.string(), z.unknown()),
  }),
  z.object({
    type: z.literal("verify"),
    query: z.record(z.string(), z.unknown()).optional(),
  }),
]);
export type LangyCardHint = z.infer<typeof langyCardHintSchema>;

/**
 * Fields every derived card carries. `blockId` is the card's identity
 * everywhere downstream: the stamped part, the preview reconciliation
 * (settled wins, by this id), and — for choices — the selection binding.
 * Required, so a card without one fails validation and renders as the
 * disclosure.
 */
const derivedCardBase = {
  blockId: z.string().min(1),
  hints: z.array(langyCardHintSchema).optional(),
} as const;

/**
 * `timeseries` — one or more named series over an ordered axis.
 *
 * The field names come from the shared vocabulary, so this and the measured
 * `timeseriesCardSchema` draw with the same chart body. What differs is
 * tolerance, stated here rather than inherited: strict objects, and a series
 * has to actually have a point in it.
 */
export const langyDerivedTimeseriesCardSchema = z.object({
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
export type LangyDerivedTimeseriesCard = z.infer<
  typeof langyDerivedTimeseriesCardSchema
>;

/** `table` — a generic derived table: named columns, rows of primitive cells. */
export const langyDerivedTableCardSchema = z.object({
  ...derivedCardBase,
  kind: z.literal("table"),
  ...tableCardFields,
});
export type LangyDerivedTableCard = z.infer<typeof langyDerivedTableCardSchema>;

/** `stats` — labelled key-value figures ("p95 latency: 812ms"). */
export const langyDerivedStatsCardSchema = z.object({
  ...derivedCardBase,
  kind: z.literal("stats"),
  ...statsCardFields,
});
export type LangyDerivedStatsCard = z.infer<typeof langyDerivedStatsCardSchema>;

/**
 * `choices` — the one sanctioned way to offer options (ADR-060 §6).
 *
 * Option ids must be unique: the selection binds by `{blockId, optionId}`, and
 * a duplicated id would make the recorded answer ambiguous — that is a failed
 * card, not a guessable one.
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

export const langyDerivedChoicesCardSchema =
  choicesCardObjectSchema.superRefine(refineUniqueOptionIds);
export type LangyDerivedChoicesCard = z.infer<typeof choicesCardObjectSchema>;

/**
 * The strict schema per derived-safe kind — gate 3.
 *
 * `Record<DerivedSafeCardKind, …>` is what forces a newly allowlisted kind to
 * arrive WITH a schema someone wrote on purpose. The union below is assembled
 * from this map rather than from a second hand-written list, so the two cannot
 * drift apart.
 *
 * The members are bare ZodObjects because a discriminated union needs them to
 * be; `choices`' uniqueness refinement is therefore re-applied at the union
 * level below.
 */
const DERIVED_SCHEMA_BY_KIND = {
  timeseries: langyDerivedTimeseriesCardSchema,
  table: langyDerivedTableCardSchema,
  stats: langyDerivedStatsCardSchema,
  choices: choicesCardObjectSchema,
} as const satisfies Record<DerivedSafeCardKind, z.ZodObject>;

/**
 * The whole channel: a derived card is exactly one of the allowlisted kinds.
 * A resource-shaped `kind` fails the discriminator and becomes a failed card —
 * the allowlist IS the schema, not a filter in front of it.
 */
export const langyDerivedCardSchema = z
  .discriminatedUnion("kind", [
    DERIVED_SCHEMA_BY_KIND.timeseries,
    DERIVED_SCHEMA_BY_KIND.table,
    DERIVED_SCHEMA_BY_KIND.stats,
    DERIVED_SCHEMA_BY_KIND.choices,
  ])
  .superRefine((card, ctx) => {
    if (card.kind === "choices") refineUniqueOptionIds(card, ctx);
  });
export type LangyDerivedCard = z.infer<typeof langyDerivedCardSchema>;

/**
 * Is this kind model-emittable? The runtime reading of the allowlist, for the
 * places that hold a `CardKind` rather than a literal.
 */
export const isDerivedSafeCardKind = (
  kind: CardKind,
): kind is DerivedSafeCardKind =>
  (DERIVED_SAFE_CARD_KINDS as readonly CardKind[]).includes(kind);
