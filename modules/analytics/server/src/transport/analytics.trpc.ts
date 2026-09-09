/**
 * The server half of `analytics.*`. A series takes `analytics:view`, the two
 * cost-oriented reads `cost:view`; nothing here decides what a series means.
 * @see modules/analytics/specs/analytics-timeseries.feature
 */
import { AnalyticsApi, analyticsTrpc } from "@langwatch/analytics-contract";
import { defineTrpcRouter } from "@langwatch/api/trpc";
import { ValidationError } from "@langwatch/handled-error";

import {
  filterFieldRequiresKey,
  filterFieldRequiresSubkey,
} from "../rules/analytics-filter-catalogue.rules.ts";

export const analyticsTrpcTransport = defineTrpcRouter(AnalyticsApi, analyticsTrpc)
  .procedure("getTimeseries")
  .withPermission("analytics:view")
  .handle(({ app, input }) => app.getTimeseries(input))

  .procedure("dataForFilter")
  .withPermission("analytics:view")
  .handle(async ({ app, input }) => {
    const { field, key, subkey } = input;

    if (filterFieldRequiresKey(field) && !key) {
      throw new ValidationError(`Field ${field} requires a key to be defined`, { httpStatus: 400 });
    }

    if (filterFieldRequiresSubkey(field) && !subkey) {
      throw new ValidationError(`Field ${field} requires a subkey to be defined`, {
        httpStatus: 400,
      });
    }

    // The narrowing rule — a field's own selection must not narrow the values
    // offered for it — belongs to the application, so both doors agree.
    const options = await app.filterOptions({
      projectId: input.projectId,
      field,
      ...(input.query === undefined ? {} : { query: input.query }),
      ...(key === undefined ? {} : { key }),
      ...(subkey === undefined ? {} : { subkey }),
      startDate: input.startDate,
      endDate: input.endDate,
      ...(input.filters === undefined ? {} : { filters: input.filters }),
    });

    return { options };
  })

  .procedure("topUsedDocuments")
  .withPermission("cost:view")
  .handle(({ app, input }) => app.getTopUsedDocuments(input))

  .procedure("feedbacks")
  .withPermission("cost:view")
  .handle(({ app, input }) => app.getFeedbacks(input))
  .build();
