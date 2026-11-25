import type { Named } from "@langwatch/module";
import { z } from "zod";

/**
 * Payload and result schemas for every Explorer action. The `.describe()`
 * prose is what `langwatch ui actions` prints, and that listing is the only
 * documentation a caller has for this surface.
 */

export const PAGE_SIZE_OPTIONS = [25, 50, 100, 250, 500, 1000] as const;

const GROUPING_MODES = ["flat", "by-conversation", "by-service", "by-user", "by-model"] as const;

const setFilterPayloadSchemaDefinition = z
  .object({
    query: z
      .string()
      .describe(
        "The filter, in the trace filter language (`langwatch query reference --section trace-filter`). An empty string clears it. Example: `event:thumbs_up_down AND event.attribute.event.metrics.vote:-1`.",
      ),
    mode: z
      .enum(["replace", "add"])
      .default("replace")
      .describe(
        '"replace" sets the whole query. "add" joins this filter to the one on screen with AND.',
      ),
  })
  .describe(
    "Set the Trace Explorer's search, which is what the search bar and the sidebar filters edit. " +
      "The table, the sidebar counts and the header count all follow. The list returns to its first page.",
  );
export interface SetFilterPayloadSchema extends Named<typeof setFilterPayloadSchemaDefinition> {}
export const setFilterPayloadSchema: SetFilterPayloadSchema = setFilterPayloadSchemaDefinition;
export type SetFilterPayload = z.input<typeof setFilterPayloadSchema>;
const setFilterResultSchemaDefinition = z.object({ query: z.string() });
export interface SetFilterResultSchema extends Named<typeof setFilterResultSchemaDefinition> {}
export const setFilterResultSchema: SetFilterResultSchema = setFilterResultSchemaDefinition;

const timeBoundSchema = z.union([z.number().int().nonnegative(), z.string().min(1)]);

const setTimeRangePayloadSchemaDefinition = z
  .union([
    z.object({
      preset: z
        .string()
        .min(1)
        .describe(
          'A rolling window by its id: "15m", "1h", "24h", "7d", "30d" and the other ids the time picker offers. It stays anchored to now.',
        ),
    }),
    z.object({
      from: timeBoundSchema.describe("Start, as epoch milliseconds or ISO 8601."),
      to: timeBoundSchema.describe("End, as epoch milliseconds or ISO 8601."),
    }),
  ])
  .describe(
    "Set the window the Trace Explorer searches in: a rolling preset, or exact bounds. " +
      "Widen it before concluding that nothing matches. The list returns to its first page.",
  );
export interface SetTimeRangePayloadSchema extends Named<
  typeof setTimeRangePayloadSchemaDefinition
> {}
export const setTimeRangePayloadSchema: SetTimeRangePayloadSchema =
  setTimeRangePayloadSchemaDefinition;
export type SetTimeRangePayload = z.input<typeof setTimeRangePayloadSchema>;
const setTimeRangeResultSchemaDefinition = z.object({
  from: z.number(),
  to: z.number(),
  presetId: z.string().optional(),
});
export interface SetTimeRangeResultSchema extends Named<
  typeof setTimeRangeResultSchemaDefinition
> {}
export const setTimeRangeResultSchema: SetTimeRangeResultSchema =
  setTimeRangeResultSchemaDefinition;

const setLensPayloadSchemaDefinition = z
  .object({
    lensId: z
      .string()
      .min(1)
      .describe(
        'The lens to open: a built-in id such as "all-traces", "conversations" or "errors", or a saved view\'s id as `explorer.getState` lists it.',
      ),
  })
  .describe(
    "Switch the Trace Explorer to another lens. The lens brings its own filter, sort, grouping and columns.",
  );
export interface SetLensPayloadSchema extends Named<typeof setLensPayloadSchemaDefinition> {}
export const setLensPayloadSchema: SetLensPayloadSchema = setLensPayloadSchemaDefinition;
export type SetLensPayload = z.input<typeof setLensPayloadSchema>;
const setLensResultSchemaDefinition = z.object({ lensId: z.string() });
export interface SetLensResultSchema extends Named<typeof setLensResultSchemaDefinition> {}
export const setLensResultSchema: SetLensResultSchema = setLensResultSchemaDefinition;

const setSortPayloadSchemaDefinition = z
  .object({
    columnId: z
      .string()
      .min(1)
      .describe('The column to sort by, such as "time", "duration" or "cost".'),
    direction: z.enum(["asc", "desc"]).default("desc"),
  })
  .describe(
    "Sort the table. Only the columns the current grouping can sort by are accepted. The list returns to its first page.",
  );
export interface SetSortPayloadSchema extends Named<typeof setSortPayloadSchemaDefinition> {}
export const setSortPayloadSchema: SetSortPayloadSchema = setSortPayloadSchemaDefinition;
export type SetSortPayload = z.input<typeof setSortPayloadSchema>;

const setGroupingPayloadSchemaDefinition = z
  .object({ grouping: z.enum(GROUPING_MODES) })
  .describe("Group the table: flat rows, or one row per conversation, service, user or model.");
export interface SetGroupingPayloadSchema extends Named<
  typeof setGroupingPayloadSchemaDefinition
> {}
export const setGroupingPayloadSchema: SetGroupingPayloadSchema =
  setGroupingPayloadSchemaDefinition;
export type SetGroupingPayload = z.input<typeof setGroupingPayloadSchema>;

const setPagePayloadSchemaDefinition = z
  .object({ page: z.number().int().min(1) })
  .describe("Go to a page of the table. Pages start at 1.");
export interface SetPagePayloadSchema extends Named<typeof setPagePayloadSchemaDefinition> {}
export const setPagePayloadSchema: SetPagePayloadSchema = setPagePayloadSchemaDefinition;
export type SetPagePayload = z.input<typeof setPagePayloadSchema>;

const setPageSizePayloadSchemaDefinition = z
  .object({
    pageSize: z
      .number()
      .int()
      .describe(`Rows per page: one of ${PAGE_SIZE_OPTIONS.join(", ")}.`),
  })
  .describe("Set how many rows a page of the table holds.");
export interface SetPageSizePayloadSchema extends Named<
  typeof setPageSizePayloadSchemaDefinition
> {}
export const setPageSizePayloadSchema: SetPageSizePayloadSchema =
  setPageSizePayloadSchemaDefinition;
export type SetPageSizePayload = z.input<typeof setPageSizePayloadSchema>;

const selectPayloadSchemaDefinition = z
  .object({
    traceIds: z
      .array(z.string())
      .max(1000)
      .default([])
      .describe("The traces to select, replacing the current selection. An empty list clears it."),
    allMatching: z
      .boolean()
      .default(false)
      .describe(
        "Select every trace matching the search instead of naming ids. The bulk actions then run over the search.",
      ),
  })
  .describe(
    "Select rows in the table, which is what the bulk actions (add to dataset, export, annotate) act on.",
  );
export interface SelectPayloadSchema extends Named<typeof selectPayloadSchemaDefinition> {}
export const selectPayloadSchema: SelectPayloadSchema = selectPayloadSchemaDefinition;
export type SelectPayload = z.input<typeof selectPayloadSchema>;
const selectResultSchemaDefinition = z.object({
  mode: z.enum(["explicit", "all-matching"]),
  selected: z.number(),
});
export interface SelectResultSchema extends Named<typeof selectResultSchemaDefinition> {}
export const selectResultSchema: SelectResultSchema = selectResultSchemaDefinition;

const toggleFacetPayloadSchemaDefinition = z
  .object({
    field: z.string().min(1).describe('A filter field, such as "status".'),
    value: z.string().min(1).describe('One of its values, such as "error".'),
    exclude: z
      .boolean()
      .default(false)
      .describe("Exclude the value instead of stepping through its states."),
  })
  .describe(
    "Click one value in the filter sidebar. A value steps from not filtered, to included, to excluded, and back. " +
      "A second value of the same field is joined to the first with OR.",
  );
export interface ToggleFacetPayloadSchema extends Named<
  typeof toggleFacetPayloadSchemaDefinition
> {}
export const toggleFacetPayloadSchema: ToggleFacetPayloadSchema =
  toggleFacetPayloadSchemaDefinition;
export type ToggleFacetPayload = z.input<typeof toggleFacetPayloadSchema>;

const expandRowPayloadSchemaDefinition = z
  .object({
    key: z.string().min(1).describe("The row's key: a conversation id, or a group's key."),
    expanded: z.boolean().optional().describe("Open (true) or close (false). Omit to toggle."),
    exclusive: z.boolean().default(false).describe("Close every other open row first."),
  })
  .describe("Open or close a conversation or group row to show what is inside it.");
export interface ExpandRowPayloadSchema extends Named<typeof expandRowPayloadSchemaDefinition> {}
export const expandRowPayloadSchema: ExpandRowPayloadSchema = expandRowPayloadSchemaDefinition;
export type ExpandRowPayload = z.input<typeof expandRowPayloadSchema>;

const getStatePayloadSchemaDefinition = z
  .object({})
  .describe(
    "Read the Trace Explorer as the user sees it: the search, the window, the lens, the sort, the page, " +
      "the count the header shows and the trace ids on the page. Read it before you change anything, " +
      "and after a change to report the count the screen shows.",
  );
export interface GetStatePayloadSchema extends Named<typeof getStatePayloadSchemaDefinition> {}
export const getStatePayloadSchema: GetStatePayloadSchema = getStatePayloadSchemaDefinition;

const runInstantEvalPayloadSchemaDefinition = z
  .object({
    instructions: z
      .string()
      .min(1)
      .max(600)
      .describe(
        "The question the judge answers for each row, such as: Does the user sound annoyed?",
      ),
    criteria: z
      .tuple([z.string().min(1).max(300), z.string().min(1).max(300)])
      .describe("What counts as yes, then what counts as no."),
    target: z
      .enum(["traces", "threads", "llm_spans"])
      .optional()
      .describe(
        "What one judged row is. Omit to judge what the lens shows: conversations on the Conversations lens, traces elsewhere. A conversation is judged with every turn's tool calls and results, so a question about what the agent did works on either.",
      ),
  })
  .describe(
    "Judge every row of the current search with a yes or no question, and keep the rows that matched. " +
      "Use it when no filter field, evaluator or event records what the user asked about. " +
      "It runs under the search bar's cost rule: it starts on its own under half a United States dollar, and otherwise the user is asked first. " +
      "The progress shows on the table.",
  );
export interface RunInstantEvalPayloadSchema extends Named<
  typeof runInstantEvalPayloadSchemaDefinition
> {}
export const runInstantEvalPayloadSchema: RunInstantEvalPayloadSchema =
  runInstantEvalPayloadSchemaDefinition;
/**
 * The run is asked for, not awaited: the cost rule decides between starting it
 * and asking the user, and either way the page shows which.
 */
const runInstantEvalResultSchemaDefinition = z.object({
  status: z.literal("requested"),
  target: z.enum(["traces", "threads", "llm_spans"]),
});
export interface RunInstantEvalResultSchema extends Named<
  typeof runInstantEvalResultSchemaDefinition
> {}
export const runInstantEvalResultSchema: RunInstantEvalResultSchema =
  runInstantEvalResultSchemaDefinition;
