/**
 * Every `analytics.*` procedure, declared once; the names are the browser's
 * cache keys. The shared inputs are the REST body's and the traces filter's too.
 * @see packages/features/analytics/specs/analytics-timeseries.feature
 */
import { defineTrpcContract } from "@langwatch/api/contract";
import { z } from "zod";

import { filterFieldsEnum } from "./analytics.filter-field.ts";
import { sharedFiltersInputSchema, timeseriesInputSchema } from "./analytics.input-schemas.ts";
import {
  analyticsFeedbacksResultSchema,
  analyticsFilterOptionsResultSchema,
  analyticsTimeseriesResultSchema,
  analyticsTopDocumentsResultSchema,
} from "./analytics.timeseries.ts";

/**
 * The narrowing `dataForFilter` adds on top of the shared filters: which field
 * is being picked for, and the free text typed into the picker.
 */
export const analyticsFilterSelectionSchema = z.object({
  field: filterFieldsEnum,
  key: z.string().optional(),
  subkey: z.string().optional(),
  query: z.string().optional(),
});

/**
 * The picker's whole request. An intersection rather than an extension, because
 * the shared half is a schema the other three procedures take whole.
 */
export const analyticsDataForFilterInputSchema = z.intersection(
  sharedFiltersInputSchema,
  analyticsFilterSelectionSchema,
);

export const analyticsTrpc = defineTrpcContract("analytics")
  .query("getTimeseries")
  .withInput(timeseriesInputSchema)
  .withOutput(analyticsTimeseriesResultSchema)

  .query("dataForFilter")
  .withInput(analyticsDataForFilterInputSchema)
  .withOutput(analyticsFilterOptionsResultSchema)

  // The full shared-filter schema is accepted for API compatibility even though
  // only projectId, startDate, endDate and filters are read; query, traceIds and
  // negateFilters are accepted and ignored.
  .query("topUsedDocuments")
  .withInput(sharedFiltersInputSchema)
  .withOutput(analyticsTopDocumentsResultSchema)

  .query("feedbacks")
  .withInput(sharedFiltersInputSchema)
  .withOutput(analyticsFeedbacksResultSchema)
  .build();
