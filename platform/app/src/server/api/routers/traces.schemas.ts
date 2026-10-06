import { z } from "zod";
import { sharedFiltersInputSchema } from "../../analytics/types";

/**
 * Offset pagination was dropped when trace search moved to ClickHouse: deep
 * OFFSET degrades badly, and keyset (`scrollId`) replaced it. The parameter was
 * left on the schema and in the published spec but no trace query has read it
 * since, so a non-zero value returned page 1 with HTTP 200 and no warning — an
 * offset-paginating export repeated the same page for as long as it ran (#6808).
 *
 * Rejected rather than deleted. Deleting the field is the worse option on the
 * public surface: the v1 route validates non-strictly, so an unknown key is
 * stripped and the request still succeeds — exactly the silence being fixed.
 * A rejection tells the caller what to use instead.
 *
 * 0 and absent stay valid. Every current caller that does not paginate sends
 * one or the other, so rejecting them would break working clients to no end.
 */
const pageOffsetInput = z
  .number()
  .optional()
  .describe(
    "Removed. Offset pagination is no longer supported and any value other " +
      "than 0 is rejected. Page with the scrollId returned by the previous " +
      "response instead. The field remains on the schema so that sending it " +
      "produces an explanatory error rather than being silently discarded.",
  )
  .refine((value) => value === undefined || value === 0, {
    message:
      "pageOffset is no longer supported — offset pagination was removed. Use the scrollId returned by the previous response to fetch the next page.",
  });

/**
 * Largest page a UI trace list read may ask for. A read buffers the whole page
 * in backend memory and in ClickHouse, so an unbounded size is a memory lever
 * any caller can pull. Same cap as tracesV2.list (#8479).
 */
export const MAX_TRACE_LIST_PAGE_SIZE = 1000;

export const tracesFilterInput = sharedFiltersInputSchema.extend({
  pageOffset: pageOffsetInput,
  // Non-negative integers only (#2163): a fractional or negative page size
  // reaches ClickHouse as a LIMIT and fails there instead of at the boundary.
  pageSize: z
    .number()
    .int()
    .positive()
    .max(MAX_TRACE_LIST_PAGE_SIZE)
    .optional(),
});

export const getAllForProjectInput = tracesFilterInput.extend({
  groupBy: z.string().optional(),
  sortBy: z.string().optional(),
  sortDirection: z.string().optional(),
  updatedAt: z.number().optional(),
  scrollId: z.string().optional().nullable(),
});

/**
 * The public REST search routes clamp pageSize to 1000 instead of rejecting, so
 * a larger value keeps working for existing API clients (#8479).
 */
export const publicTraceSearchPageSizeInput = z
  .number()
  .int()
  .positive()
  .optional();

/**
 * Downloads are a deliberate bulk read and keep their 10 000 default
 * (see traces.ts), so they are not held to the list page cap (#8479).
 */
export const getAllForDownloadInput = getAllForProjectInput.extend({
  includeSpans: z.boolean(),
  pageSize: z.number().int().positive().optional(),
});
