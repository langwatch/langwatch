/**
 * The spend reconciliation REST vocabulary: the query each read accepts, the body a replay
 * posts, and the rows each answers with. Published once so the doc, the route and a
 * reconciliation client agree.
 */
import { z } from "zod";

import {
  gatewaySpendEventEnvelopeSchema,
  MAX_FILTER_VALUES,
  spendStatusFilter,
} from "./gateway-spend.schemas.ts";
import { USD_DISPLAY_STRING_FORMAT } from "./gateway.money.ts";

export const SPEND_GROUP_BY_KEYS = [
  "virtual_key",
  "end_user",
  "project",
  "model",
  "provider",
  "principal",
  "request_type",
] as const;

export type SpendGroupByKey = (typeof SPEND_GROUP_BY_KEYS)[number];

export const SPEND_BUCKETS = ["none", "hour", "day"] as const;
export type SpendBucket = (typeof SPEND_BUCKETS)[number];

/** At most two: a third dimension multiplies the group count past what a
 *  single cursor walk can serve at a useful page size. */
export const MAX_GROUP_BY_KEYS = 2;

/**
 * Whether this is a named zone the runtime knows.
 */
export function isIanaTimeZone(zone: string): boolean {
  if (!/^[A-Za-z]/.test(zone)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Lifecycle status for a spend row with no outcome yet — named once so
 * the rollup sum excludes it and the rollup's status filter refuses it,
 * rather than accepting a narrowing that can only answer nothing.
 */
export const SPEND_STATUS_IN_FLIGHT = "admitted" as const;

/**
 * Rollup status filter: shared vocabulary minus in-flight, DERIVED by exclusion
 * so a new status is added to both automatically — accepting in-flight here would
 * answer a confident zero a reconciliation could mistake for agreement.
 */
export const spendSummaryStatusFilter = spendStatusFilter.exclude([SPEND_STATUS_IN_FLIGHT]);

/** Why the rollups read publishes a narrower `status` than the events read. */
export const SPEND_SUMMARY_STATUS_DESCRIPTION =
  "Narrow to one lifecycle status. `admitted` is not accepted here: a rollup sums the cost of requests past admission, and an admitted request is still in flight with no cost of its own yet. Ask /spend-events for those.";

const id = z.string().min(1).max(100);
const longId = z.string().min(1).max(256);

/**
 * `key:value`, split on the FIRST colon (value may hold one, key may not).
 * Both halves must be non-empty: a missing Map key answers with the type
 * default, so `tier:` would match every row with no `tier` at all.
 */
const metadataPair = z
  .string()
  .min(3)
  .max(640)
  .refine(
    (raw) => {
      const separator = raw.indexOf(":");
      return separator > 0 && separator < raw.length - 1;
    },
    {
      message: "metadata must be written key:value, with both sides non-empty",
    },
  );

/**
 * A repeatable filter: Hono returns a query param as a string when it
 * appears once and an array when it repeats, so accepting only one
 * shape would reject the commoner half of real traffic.
 */
export function repeatable(
  inner: z.ZodType<string, string>,
): z.ZodType<string[], string | string[]> {
  return z
    .union([inner, z.array(inner).max(MAX_FILTER_VALUES)])
    .transform((value): string[] => (Array.isArray(value) ? value : [value]));
}

/**
 * The query-parameter shape both spend reads mount. Spread into each route's
 * schema rather than extended from it, because the two carry different
 * windows, cursors and page sizes around this common core.
 */
export const spendFilterQueryShape = {
  project_id: repeatable(id).optional(),
  team_id: repeatable(id).optional(),
  external_id: repeatable(z.string().min(1).max(200)).optional(),
  virtual_key_id: repeatable(id).optional(),
  end_user_id: repeatable(longId).optional(),
  principal_user_id: repeatable(id).optional(),
  model: repeatable(z.string().min(1).max(200)).optional(),
  provider_key: repeatable(id).optional(),
  request_type: repeatable(z.string().min(1).max(50)).optional(),
  label: repeatable(z.string().min(1).max(200)).optional(),
  metadata: repeatable(metadataPair).optional(),
  status: spendStatusFilter.optional(),
} as const;

/** The parsed shape of {@link spendFilterQueryShape}. */
export type SpendFilterQuery = z.infer<z.ZodObject<typeof spendFilterQueryShape>>;

/** Milliseconds, not seconds: a seconds epoch silently lands in 1970 and reads empty. */
export const gatewayEpochMsSchema = z.coerce
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER)
  .meta({
    description:
      "Milliseconds since the Unix epoch, not seconds. An epoch in seconds is a valid integer here and answers for 1970, so a mismatched unit reads as an empty window rather than as an error.",
    example: 1782864000000,
  });

export const gatewaySpendEventsQuerySchema = z
  .object({
    // The reconciliation pull is a RANGED read by contract: without bounds
    // the walk sorts the whole 13-month table under FINAL on every page.
    from: gatewayEpochMsSchema,
    to: gatewayEpochMsSchema,
    cursor: z.string().max(500).optional(),
    limit: z.coerce.number().int().positive().max(200).optional().default(50),
    ...spendFilterQueryShape,
  })
  .refine((q) => q.from <= q.to, {
    message: "from must be less than or equal to to",
  });

export const GATEWAY_END_USER_SPEND_WINDOWS = {
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
} as const;

export const gatewayEndUserSpendQuerySchema = z.object({
  window: z.enum(["day", "week", "month"]).optional().default("month"),
  from: z.coerce.number().int().positive().optional(),
  to: z.coerce.number().int().positive().optional(),
  virtual_key_id: z.string().min(1).max(100).optional(),
});

export const gatewayEndUserSpendParamsSchema = z.object({ id: z.string().min(1) });

// ── Response DTO schemas ───────────────────────────────────────────────
// These mirror the shapes the handlers below return. Without them the
// generated spec documents these routes with `responses: {}`, so a caller
// reading the spec learns the route exists and nothing about what it answers.

export const gatewaySpendUsageSchema = z.object({
  input_tokens: z.number().int(),
  output_tokens: z.number().int(),
  cache_read_input_tokens: z.number().int(),
  cache_creation_input_tokens: z.number().int(),
  reasoning_tokens: z.number().int(),
});

/**
 * `usageSchema` plus image quantities, for this repository's own rollups
 * (spend-summaries, end-user spend). /spend-events stays on the base schema
 * since the shared webhook envelope builder doesn't carry these fields yet.
 */
export const gatewaySpendUsageWithImagesSchema = z.object({
  ...gatewaySpendUsageSchema.shape,
  // Always present, 0 on a request/rollup that used no images. The object
  // already carries the cache and reasoning counts as 0 when unused, so an
  // optional field would put two conventions in one payload; reconciliation
  // consumers sum these fields, and a missing one turns a sum into NaN where
  // a 0 does not.
  input_image_tokens: z
    .number()
    .int()
    .describe(
      "Image tokens billed on the input side, 0 when no image was used. Priced at its own rate and disjoint from input_tokens, which never includes it.",
    ),
  output_image_tokens: z
    .number()
    .int()
    .describe(
      "Image tokens the answer was billed for, 0 when no answer held one. Priced at its own rate and disjoint from output_tokens: an image_generation row reports output_tokens 0 and its render here, so a reconciler reading output_tokens alone sees none of the image traffic.",
    ),
  image_count: z
    .number()
    .int()
    .describe(
      "Images carried, 0 when none were. Display only: no rate prices it, so it never belongs in a cost sum.",
    ),
});

/** Money is published twice: a display string and the canonical integer. */
export const gatewaySpendCostSchema = z.object({
  total_usd: z
    .string()
    .describe(`Display value. ${USD_DISPLAY_STRING_FORMAT} Use nano_usd for arithmetic.`),
  nano_usd: z
    .number()
    .int()
    .describe(
      "Canonical integer cost, nano-USD. Rated as an integer and summed as one, so this is the figure to reconcile against.",
    ),
});

/** Null when the walk is exhausted. A full page does NOT imply more. */
export const gatewaySpendNextCursorSchema = z.string().nullable();

export const gatewaySpendSummaryRowSchema = z.object({
  /** The first grouping dimension's value, unchanged from when a rollup could
   *  only be grouped one way. Read `group` to tell two dimensions apart. */
  key: z.string(),
  /** Every grouping dimension by name, e.g. `{ "model": "gpt-5-mini" }`. */
  group: z.record(z.string(), z.string()),
  /** Start of the time bucket in the requested timezone, null when unbucketed. */
  bucket_start: z.string().nullable(),
  event_count: z.number().int(),
  settled_count: z.number().int(),
  usage: gatewaySpendUsageWithImagesSchema,
  cost: gatewaySpendCostSchema,
});

export const gatewayEndUserCapSchema = z.object({
  budget_id: z.string(),
  anchor_id: z.string(),
  window: z.string(),
  on_breach: z.enum(["block", "warn"]),
  limit_usd: z.string().describe(`The cap for this end user. ${USD_DISPLAY_STRING_FORMAT}`),
  spent_usd: z.string().describe(`Spend against that cap. ${USD_DISPLAY_STRING_FORMAT}`),
  period_started_at: z.string(),
});

export const gatewayEndUserSpendSchema = z.object({
  end_user_id: z.string(),
  window: z.string(),
  from: z.string(),
  to: z.string(),
  cost: gatewaySpendCostSchema,
  request_count: z.number().int(),
  usage: gatewaySpendUsageWithImagesSchema,
  caps: z.array(gatewayEndUserCapSchema),
});

/** The refusals every route here documents; the 200 comes from its output. */

/** Validated in the transform, not an array schema, so a refusal names group_by, not group_by.0. */
export const gatewaySpendGroupBySchema = z
  .string()
  .transform((raw, ctx): SpendGroupByKey[] => {
    const keys = raw.split(",").map((part) => part.trim());
    const refuse = (message: string): typeof z.NEVER => {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message });
      return z.NEVER;
    };
    const unknown = keys.filter((key) => !SPEND_GROUP_BY_KEYS.includes(key as SpendGroupByKey));
    if (unknown.length > 0) {
      return refuse(`group_by must name one or two of ${SPEND_GROUP_BY_KEYS.join(", ")}`);
    }
    if (keys.length > MAX_GROUP_BY_KEYS) {
      return refuse(`group_by takes at most ${MAX_GROUP_BY_KEYS} dimensions`);
    }
    if (new Set(keys).size !== keys.length) {
      return refuse("group_by cannot repeat a dimension");
    }
    return keys as SpendGroupByKey[];
  })
  .meta({
    description: `One or two dimensions, comma separated: ${SPEND_GROUP_BY_KEYS.join(", ")}. A dimension may not repeat. Each row's \`key\` is the first dimension's value and \`group\` names them all, so two rows may share a key.`,
    example: "model,end_user",
  });

/** What a query string may say for yes and for no. Compared case-folded. */
const QUERY_BOOLEAN_TRUE = ["true", "1", "yes"];
const QUERY_BOOLEAN_FALSE = ["false", "0", "no", ""];

/**
 * z.coerce.boolean() is JS Boolean(): every non-empty string is true, so allow_unstable=false
 * would turn the guard OFF. Case is folded since the caller's HTTP library picks it, not them.
 */
export const gatewayQueryBooleanSchema = z
  .string()
  .optional()
  .default("false")
  .transform((raw, ctx): boolean | typeof z.NEVER => {
    const spelling = raw.toLowerCase();
    if (QUERY_BOOLEAN_TRUE.includes(spelling)) return true;
    if (QUERY_BOOLEAN_FALSE.includes(spelling)) return false;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `must be one of ${[...QUERY_BOOLEAN_TRUE, ...QUERY_BOOLEAN_FALSE.filter(Boolean)].join(", ")}`,
    });
    return z.NEVER;
  })
  .meta({
    description: [
      `${QUERY_BOOLEAN_TRUE.join(", ")} for yes;`,
      `${QUERY_BOOLEAN_FALSE.filter(Boolean).join(", ")} or omitted for no.`,
      "Case does not matter, so a Python True is accepted as sent.",
    ].join(" "),
    example: "true",
  });

export const gatewaySpendSummariesQuerySchema = z
  .object({
    group_by: gatewaySpendGroupBySchema,
    bucket: z.enum(SPEND_BUCKETS).optional().default("none"),
    // An IANA zone, because a day boundary is the caller's local midnight and
    // re-bucketing UTC days afterwards cannot recover the requests that fell
    // on the other side of it. Checked here so an unknown zone is a 400 that
    // names the parameter rather than a ClickHouse error the caller cannot act
    // on.
    timezone: z
      .string()
      .min(1)
      .max(64)
      .refine((zone) => isIanaTimeZone(zone), {
        message: "timezone must be an IANA zone name, e.g. Europe/Amsterdam",
      })
      .optional()
      .default("UTC"),
    allow_unstable: gatewayQueryBooleanSchema,
    from: gatewayEpochMsSchema,
    to: gatewayEpochMsSchema,
    cursor: z.string().max(500).optional(),
    limit: z.coerce.number().int().positive().max(1000).optional().default(500),
    ...spendFilterQueryShape,
    // The one filter this read narrows further than /spend-events does. A
    // rollup excludes in-flight rows from every sum, so accepting `admitted`
    // would answer a real question with a confident zero. The refusal names
    // the parameter, so a caller can act on it, and the events read still
    // serves those envelopes.
    status: spendSummaryStatusFilter
      .optional()
      .meta({ description: SPEND_SUMMARY_STATUS_DESCRIPTION }),
  })
  // An inverted window is an empty window, so a caller who swapped the two
  // reads a confident zero and reconciles against it. /spend-events has
  // refused this since it shipped; this surface answered instead.
  .refine((q) => q.from <= q.to, {
    message: "from must be less than or equal to to",
  });

/** A page of spend rollups; follow `next_cursor` until it comes back null. */
export const gatewaySpendSummariesPageSchema = z.object({
  data: z.array(gatewaySpendSummaryRowSchema),
  next_cursor: gatewaySpendNextCursorSchema,
});
export type GatewaySpendSummariesPage = z.infer<typeof gatewaySpendSummariesPageSchema>;

/** A page of the per-request ledger, as the canonical billing envelopes. */
export const gatewaySpendEventsPageSchema = z.object({
  data: z.array(gatewaySpendEventEnvelopeSchema),
  next_cursor: gatewaySpendNextCursorSchema,
});
export type GatewaySpendEventsPage = z.infer<typeof gatewaySpendEventsPageSchema>;

export const gatewayEndUserSpendResponseSchema = z.object({ data: gatewayEndUserSpendSchema });
export type GatewayEndUserSpendResponse = z.infer<typeof gatewayEndUserSpendResponseSchema>;

export type GatewaySpendSummariesQuery = z.output<typeof gatewaySpendSummariesQuerySchema>;
export type GatewaySpendEventsQuery = z.output<typeof gatewaySpendEventsQuerySchema>;
export type GatewayEndUserSpendQuery = z.output<typeof gatewayEndUserSpendQuerySchema> &
  z.output<typeof gatewayEndUserSpendParamsSchema>;
