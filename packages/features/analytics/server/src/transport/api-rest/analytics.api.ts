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
import {
  type AppRestSecurity,
  baseResponses,
  coerceToEpoch,
  type EndpointVariables,
  MANAGEMENT_API_VERSION,
  type MountableRestApp,
  type ServiceContext,
} from "@langwatch/api/rest";
import { isZodLikeError, ValidationError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import { TRPCError } from "@trpc/server";
import type { Context, ErrorHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import type { AnalyticsApi } from "@langwatch/analytics-contract";

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
 * A bare zod rejection carries no status, so a boundary that reads only
 * handled errors would answer 500 where this endpoint answers 422.
 */
const promotingBoundary =
  (boundary: ErrorHandler): ErrorHandler =>
  (error, c) =>
    boundary(isZodLikeError(error) ? ValidationError.fromZodError(error) : error, c);

/** The project the credential resolved to, as this transport reads it. */
const projectOf = (c: Context): { id: string } => c.get("project") as { id: string };

/**
 * The wire answer as this endpoint documents and sends it: two arrays of
 * buckets, each an open record. Looser than the contract's
 * `analyticsTimeseriesResultSchema`, which this door never enforced outbound.
 */
export const timeseriesResponseSchema = z.object({
  currentPeriod: z.array(z.record(z.string(), z.any())),
  previousPeriod: z.array(z.record(z.string(), z.any())),
});

/**
 * REST for a project's analytics timeseries, built against one process's
 * security.
 */
export function createAnalyticsRestApp(options: {
  security: AppRestSecurity;
  /**
   * Resolved per request, as reading it off the Hono context used to be:
   * mounting a family must not force its services to be constructed, which is
   * what lets the OpenAPI spec generator build this app with none.
   */
  analytics: () => AnalyticsApi;
  /**
   * The host's published timeseries body — its metric, group and filter-field
   * catalogue — with the period bounds accepting an ISO string as well as
   * epoch milliseconds.
   */
  requestSchema: z.ZodObject;
}): MountableRestApp {
  const { security, analytics, requestSchema } = options;

  const { service, policy } = security.createProjectVersionedApp({
    name: "analytics",
    basePath: "/api/analytics",
    errorEnvelope: "legacy",
    errorHandler: promotingBoundary,
  });

  const timeseriesHandler = async (
    c: ServiceContext<EndpointVariables>,
    params: AnalyticsTimeseriesRestBody,
  ) => {
    const project = projectOf(c);

    logger.info({ projectId: project.id }, "Querying analytics timeseries");

    const input = {
      ...params,
      projectId: project.id,
      startDate: coerceToEpoch(params.startDate),
      endDate: coerceToEpoch(params.endDate),
    };

    try {
      return await analytics().getTimeseries(input);
    } catch (e) {
      if (e instanceof TRPCError && e.code === "BAD_REQUEST") {
        throw new HTTPException(400, { message: e.message });
      }
      throw e;
    }
  };

  // Read scope: analytics:view (mirrors the tRPC analytics router + the
  // dashboards/graphs sibling apps).
  return service
    .registerRoute("post", "/timeseries", MANAGEMENT_API_VERSION, timeseriesHandler, (b) =>
      policy("analytics:view")(b)
        .withInput(requestSchema)
        .withOutput(timeseriesResponseSchema)
        .withDocs({
          operationId: "queryAnalyticsTimeseries",
          tags: ["Analytics"],
          description: "Query analytics timeseries data with metrics, aggregations, and filters",
          responses: baseResponses,
        }),
    )
    .build();
}
