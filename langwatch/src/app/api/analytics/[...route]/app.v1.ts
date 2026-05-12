import { TRPCError } from "@trpc/server";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { describeRoute } from "hono-openapi";
import { resolver, validator as zValidator } from "hono-openapi/zod";
import { z } from "zod";
import { getAnalyticsService } from "~/server/analytics/analytics.service";
import { timeseriesSeriesInput } from "~/server/analytics/registry";
import { sharedFiltersInputSchema } from "~/server/analytics/types";
import { createLogger } from "~/utils/logger/server";
import type { AuthMiddlewareVariables } from "../../middleware";
import { baseResponses } from "../../shared/base-responses";
import { coerceToEpoch, flexibleDateSchema } from "../../shared/schemas";

const logger = createLogger("langwatch:api:analytics");

type Variables = AuthMiddlewareVariables;

export const app = new Hono<{
  Variables: Variables;
}>().basePath("/");

// Body schema: combine shared filters + timeseries series input, but
// omit projectId (comes from auth) and allow ISO string dates alongside epoch numbers.
const analyticsBodySchema = sharedFiltersInputSchema
  .omit({ projectId: true })
  .extend(timeseriesSeriesInput.shape)
  .extend({
    startDate: flexibleDateSchema,
    endDate: flexibleDateSchema,
  });

// POST /timeseries - Query analytics timeseries
app.post(
  "/timeseries",
  describeRoute({
    description:
      "Query analytics timeseries data with metrics, aggregations, and filters",
    responses: {
      ...baseResponses,
      200: {
        description:
          "Timeseries analytics data with current and previous periods",
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
  zValidator("json", analyticsBodySchema),
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
      const analyticsService = getAnalyticsService();
      const timeseriesResult = await analyticsService.getTimeseries(input);
      return c.json(timeseriesResult);
    } catch (e) {
      if (e instanceof TRPCError && e.code === "BAD_REQUEST") {
        throw new HTTPException(400, { message: e.message });
      }
      throw e;
    }
  },
);
