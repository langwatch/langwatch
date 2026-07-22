/**
 * The model-emitted block schemas (ADR-060 §3) — the closed, derived-safe
 * allowlist of what a ```langy-card fence may carry.
 *
 * Three data kinds that are pure presentation of supplied values (a
 * timeseries, a generic table, key-value stats) plus the `choices` question
 * card (§6). Deliberately NOT here: any resource-shaped kind (`traces`,
 * `evalRun`, `resourceCreated`, …) — a model that can emit a traces card can
 * assert records that were never searched for, so those kinds simply do not
 * validate on this channel.
 *
 * These schemas are the STRICT half of "transport-tolerant, boundary-strict":
 * salvage (salvage.ts) repairs the JSON as aggressively as it can, and the
 * repaired document must then pass one of these — a payload that parses but
 * does not validate is a failed block, never a guessed card. Both the relay
 * stamp and the client preview validate through this one module, so the two
 * runtimes cannot disagree about what a block means.
 *
 * The timeseries shape mirrors `@langwatch/cli-cards`' timeseriesCardSchema
 * (series of named `{t, v}` points, optional unit/comparison) so the derived
 * chart renders through the same widget vocabulary as the measured one — the
 * chrome, not the shape, is what tells them apart (ADR-060 §4).
 */
import { z } from "zod";

/** Every kind a model-emitted block may claim. Closed by construction. */
export const LANGY_CARD_BLOCK_KINDS = [
  "timeseries",
  "table",
  "stats",
  "choices",
] as const;

export type LangyCardBlockKind = (typeof LANGY_CARD_BLOCK_KINDS)[number];

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
 * Fields every block carries. `blockId` is the block's identity everywhere
 * downstream: the stamped part, the preview reconciliation (settled wins, by
 * this id), and — for choices — the selection binding. Required, so a block
 * without one fails validation and renders as the disclosure.
 */
const blockBase = {
  blockId: z.string().min(1),
  hints: z.array(langyCardHintSchema).optional(),
} as const;

/** One plotted point: x (ISO date, bucket label, or epoch) and value. */
const timeseriesPointSchema = z.object({
  t: z.union([z.string(), z.number()]),
  v: z.number(),
});

/**
 * `timeseries` — one or more named series over an ordered axis. Field names
 * mirror the measured timeseries card so both draw with the same chart body.
 */
export const langyTimeseriesBlockSchema = z.object({
  ...blockBase,
  kind: z.literal("timeseries"),
  title: z.string().optional(),
  unit: z.enum(["usd", "count", "ms", "percent", "tokens"]).optional(),
  series: z
    .array(
      z.object({
        name: z.string().min(1),
        points: z.array(timeseriesPointSchema).min(1),
      }),
    )
    .min(1),
  comparison: z
    .object({
      label: z.string(),
      value: z.number(),
      baselineLabel: z.string(),
      baseline: z.number(),
    })
    .optional(),
});
export type LangyTimeseriesBlock = z.infer<typeof langyTimeseriesBlockSchema>;

/** A table cell is a JSON primitive — never a nested structure to render. */
const tableCellSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);

/**
 * `table` — a generic derived table: named columns, rows of primitive cells.
 * Row length is deliberately not pinned to the column count: a ragged row
 * renders short rather than failing the whole block.
 */
export const langyTableBlockSchema = z.object({
  ...blockBase,
  kind: z.literal("table"),
  title: z.string().optional(),
  columns: z.array(z.string().min(1)).min(1),
  rows: z.array(z.array(tableCellSchema)),
});
export type LangyTableBlock = z.infer<typeof langyTableBlockSchema>;

/** `stats` — labelled key-value figures ("p95 latency: 812ms"). */
export const langyStatsBlockSchema = z.object({
  ...blockBase,
  kind: z.literal("stats"),
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
});
export type LangyStatsBlock = z.infer<typeof langyStatsBlockSchema>;

/**
 * `choices` — the one sanctioned way to offer options (ADR-060 §6). An option
 * may ground itself in a real entity via `ref`; the platform hydrates the ref
 * as the VIEWER through the existing id-reference seam, so a dead ref renders
 * disabled and a live one renders with current, permission-true detail.
 *
 * Option ids must be unique: the selection binds by `{blockId, optionId}`,
 * and a duplicated id would make the recorded answer ambiguous — that is a
 * failed block, not a guessable one.
 */
const choicesBlockObjectSchema = z.object({
  ...blockBase,
  kind: z.literal("choices"),
  question: z.string().min(1),
  options: z
    .array(
      z.object({
        id: z.string().min(1),
        label: z.string().min(1),
        description: z.string().optional(),
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
});

/** Reject duplicated option ids — shared by the union and the direct schema. */
function refineUniqueOptionIds(
  block: z.infer<typeof choicesBlockObjectSchema>,
  ctx: z.RefinementCtx,
): void {
  const seen = new Set<string>();
  for (const option of block.options) {
    if (seen.has(option.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `duplicate option id "${option.id}"`,
        path: ["options"],
      });
      return;
    }
    seen.add(option.id);
  }
}

export const langyChoicesBlockSchema =
  choicesBlockObjectSchema.superRefine(refineUniqueOptionIds);
export type LangyChoicesBlock = z.infer<typeof choicesBlockObjectSchema>;

/**
 * The whole channel: a block is exactly one of the allowlisted kinds. A
 * resource-shaped `kind` fails the discriminator and becomes a failed block —
 * the allowlist is the schema, not a filter in front of it.
 *
 * The union members must be bare ZodObjects (zod v3 discriminatedUnion), so
 * the choices uniqueness refinement re-applies here at the union level.
 */
export const langyCardBlockSchema = z
  .discriminatedUnion("kind", [
    langyTimeseriesBlockSchema,
    langyTableBlockSchema,
    langyStatsBlockSchema,
    choicesBlockObjectSchema,
  ])
  .superRefine((block, ctx) => {
    if (block.kind === "choices") refineUniqueOptionIds(block, ctx);
  });
export type LangyCardBlock = z.infer<typeof langyCardBlockSchema>;
