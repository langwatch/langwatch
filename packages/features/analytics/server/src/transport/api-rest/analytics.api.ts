/**
 * The analytics timeseries REST endpoint.
 *
 * `POST /api/analytics/timeseries` answers the same question the browser's
 * `analytics.getTimeseries` procedure does, through the same
 * {@link AnalyticsApp}, so a rule added on one door cannot leave the other
 * answering the old way. The only difference is the wire: this door accepts an
 * ISO string as well as epoch milliseconds for the period bounds, and it takes
 * the project from the credential rather than from the body.
 *
 * The request schema arrives as a port. The metric names, the group-by keys
 * and the filter fields a caller may send are the host's analytics catalogue —
 * a 429-line registry of labels, formats and colour sets that the browser
 * shares — and the published endpoint accepts exactly that enumeration today.
 * Restating a looser schema here would widen a public API, so the process
 * supplies the one it already publishes.
 *
 * @see ~/server/analytics/registry — the catalogue the host's schema is built from
 */
import type { AnalyticsTimeseriesInput } from "@langwatch/analytics-contract";
import { requires } from "@langwatch/api";
import {
  type AppRestProjectVariables,
  type AppRestSecurity,
  baseResponses,
  coerceToEpoch,
  type SecuredApp,
  validator as zValidator,
} from "@langwatch/api/rest";
import { createLogger } from "@langwatch/observability";
import { TRPCError } from "@trpc/server";
import { HTTPException } from "hono/http-exception";
import { describeRoute, resolver } from "hono-openapi";
import { z } from "zod";

import type { AnalyticsApp } from "#app/analytics.app";

const logger = createLogger("langwatch:api:analytics");

/**
 * The timeseries request as this door accepts it: everything the application
 * reads except the project, which comes from the credential, and with the
 * period bounds still in whichever of the two accepted spellings the caller
 * sent them.
 */
export type AnalyticsTimeseriesRestBody = Omit<
  AnalyticsTimeseriesInput,
  "projectId" | "startDate" | "endDate"
> &
  Readonly<{ startDate: string | number; endDate: string | number }>;

/**
 * REST for a project's analytics timeseries, built against one process's
 * security.
 */
export function createAnalyticsRestApp<
  TBody extends AnalyticsTimeseriesRestBody,
  TBodyRaw,
>(options: {
  security: AppRestSecurity;
  /**
   * Resolved per request, as reading it off the Hono context used to be:
   * mounting a family must not force its services to be constructed, which is
   * what lets the OpenAPI spec generator build this app with none.
   */
  analytics: () => AnalyticsApp;
  /**
   * The host's published timeseries body — its metric, group and filter-field
   * catalogue — with the period bounds accepting an ISO string as well as
   * epoch milliseconds. Both the parsed shape and the shape a caller SENDS are
   * carried, because they differ, and the validator types the 400 body off the
   * sent shape.
   */
  requestSchema: z.ZodType<TBody, TBodyRaw>;
}): SecuredApp<{ Variables: AppRestProjectVariables }> {
  const { security, analytics, requestSchema } = options;

  const secured = security.createProjectApp({
    basePath: "/api/analytics",
  });

  // POST /timeseries - Query analytics timeseries. Read scope: analytics:view
  // (mirrors the tRPC analytics router + the dashboards/graphs sibling apps).
  secured.access(requires("analytics:view")).post(
    "/timeseries",
    describeRoute({
      description: "Query analytics timeseries data with metrics, aggregations, and filters",
      responses: {
        ...baseResponses,
        200: {
          description: "Timeseries analytics data with current and previous periods",
          content: {
            "application/json": {
              schema: resolver(
                z.object({
                  currentPeriod: z.array(z.record(z.string(), z.any())),
                  previousPeriod: z.array(z.record(z.string(), z.any())),
                }),
              ),
            },
          },
        },
      },
    }),
    zValidator("json", requestSchema),
    async (c) => {
      const project = c.get("project");
      const params = c.req.valid("json");

      logger.info({ projectId: project.id }, "Querying analytics timeseries");

      const input = {
        ...params,
        projectId: project.id,
        startDate: coerceToEpoch(params.startDate),
        endDate: coerceToEpoch(params.endDate),
      };

      try {
        const timeseriesResult = await analytics().getTimeseries(input);
        return c.json(timeseriesResult);
      } catch (e) {
        if (e instanceof TRPCError && e.code === "BAD_REQUEST") {
          throw new HTTPException(400, { message: e.message });
        }
        throw e;
      }
    },
  );

  return secured;
}
